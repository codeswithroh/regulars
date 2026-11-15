// On-chain history for a shop, read straight from its two contract addresses. No indexer, no
// backend: the contract outputs are the ledger. Results feed the dashboard charts.
import { binToHex, decodeTransaction, hexToBin, type Transaction } from '@bitauth/libauth';
import { makeIssuer, makeReserve, type Shop } from '@regulars/contracts';
import { protocol } from './config';
import { online, provider } from './wallet';

export type EventKind = 'open' | 'earn' | 'redeem' | 'fund' | 'collect' | 'close';

export interface ShopEvent {
  txid: string;
  kind: EventKind;
  /** Unix seconds; transactions still in the mempool get the time they were first seen. */
  time: number;
  pending: boolean;
  stamps: bigint;
  /** earn: paid to the shop. redeem: released by the reserve. fund/open: added to the reserve. */
  sats: bigint;
  /** hash160 (hex) of the customer, when the transaction pays a plain address. */
  customer?: string;
}

const MAX_TXS = 120;
const txCache = new Map<string, Promise<Transaction>>();
const timeCache = new Map<number, Promise<number>>();
const firstSeen = new Map<string, number>();
/** When a mempool transaction was first seen, kept across reloads so it doesn't read "now" forever. */
function seenAt(txid: string): number {
  let t = firstSeen.get(txid);
  if (t === undefined) {
    const key = `regulars:seen:${txid}`;
    try { t = Number(localStorage.getItem(key)) || undefined; } catch { /* storage unavailable */ }
    if (t === undefined) {
      t = Math.floor(Date.now() / 1000);
      try { localStorage.setItem(key, String(t)); } catch { /* storage unavailable */ }
    }
    firstSeen.set(txid, t);
  }
  return t;
}

function getTx(txid: string) {
  let cached = txCache.get(txid);
  if (!cached) {
    cached = provider.getRawTransaction(txid).then((hex) => {
      const tx = decodeTransaction(hexToBin(hex));
      if (typeof tx === 'string') throw new Error(tx);
      return tx;
    });
    cached.catch(() => txCache.delete(txid));
    txCache.set(txid, cached);
  }
  return cached;
}

function blockTime(height: number): Promise<number> {
  let cached = timeCache.get(height);
  if (!cached) {
    const key = `regulars:h:${height}`;
    let stored: string | null = null;
    try { stored = localStorage.getItem(key); } catch { /* storage unavailable */ }
    cached = stored ? Promise.resolve(Number(stored)) : (provider.performRequest('blockchain.block.header', height) as Promise<string>).then((hex) => {
      const b = hexToBin(hex);
      const time = (b[68] | (b[69] << 8) | (b[70] << 16) | (b[71] << 24)) >>> 0;
      try { localStorage.setItem(key, String(time)); } catch { /* storage unavailable */ }
      return time;
    });
    cached.catch(() => timeCache.delete(height));
    timeCache.set(height, cached);
  }
  return cached;
}

type HistoryEntry = { tx_hash: string; height: number };
const historyOf = async (address: string) =>
  ((await provider.performRequest('blockchain.address.get_history', address)) as HistoryEntry[]) ?? [];

const p2pkhOwner = (lock: Uint8Array) =>
  lock.length === 25 && lock[0] === 0x76 && lock[1] === 0xa9 && lock[2] === 0x14 && lock[23] === 0x88 && lock[24] === 0xac
    ? binToHex(lock.slice(3, 23)) : undefined;

async function inChunks<T, R>(items: T[], size: number, work: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

/** Every Regulars event for a shop, newest first. */
export async function shopHistory(shop: Shop): Promise<ShopEvent[]> {
  await online();
  const issuer = makeIssuer(shop, protocol, provider);
  const reserve = makeReserve(shop, provider);
  const issuerLock = issuer.lockingBytecode;
  const reserveLock = reserve.lockingBytecode;
  const merchantLock = `76a914${shop.merchantPkh}88ac`;
  const isStamp = (o: Transaction['outputs'][number]) => Boolean(o.token) && binToHex(o.token!.category) === shop.category && !o.token!.nft;

  const [issuerHistory, reserveHistory] = await Promise.all([historyOf(issuer.address), historyOf(reserve.address)]);
  const heights = new Map<string, number>();
  for (const entry of [...issuerHistory, ...reserveHistory]) heights.set(entry.tx_hash, entry.height);
  const order = (h: number) => (h <= 0 ? Number.MAX_SAFE_INTEGER : h);
  const txids = [...heights.keys()].sort((a, b) => order(heights.get(b)!) - order(heights.get(a)!)).slice(0, MAX_TXS);

  const events = await inChunks(txids, 12, async (txid): Promise<ShopEvent | undefined> => {
    const tx = await getTx(txid);
    const height = heights.get(txid)!;
    const pending = height <= 0;
    const time = pending ? seenAt(txid) : await blockTime(height);
    const unlock = tx.inputs.map((input) => binToHex(input.unlockingBytecode));
    const issuerIn = unlock.findIndex((u) => u.includes(issuer.bytecode));
    const reserveIn = unlock.findIndex((u) => u.includes(reserve.bytecode));
    const locks = tx.outputs.map((o) => binToHex(o.lockingBytecode));
    const base = { txid, time, pending };

    if (issuerIn >= 0) {
      const selector = tx.inputs[issuerIn].unlockingBytecode[0];
      if (selector === 0x00) {
        const given = tx.outputs.filter((o, i) => isStamp(o) && locks[i] !== issuerLock);
        const stamps = given.reduce((s, o) => s + o.token!.amount, 0n);
        const paid = tx.outputs.find((_, i) => locks[i] === merchantLock)?.valueSatoshis ?? 0n;
        const customer = given.map((o) => p2pkhOwner(o.lockingBytecode)).find(Boolean);
        return { ...base, kind: 'earn', stamps, sats: paid, customer };
      }
      return { ...base, kind: selector === 0x51 ? 'collect' : 'close', stamps: 0n, sats: 0n };
    }
    if (reserveIn >= 0) {
      const input = tx.inputs[reserveIn];
      if (input.unlockingBytecode[0] !== 0x00) return { ...base, kind: 'close', stamps: 0n, sats: 0n };
      const prev = (await getTx(binToHex(input.outpointTransactionHash))).outputs[input.outpointIndex];
      const next = tx.outputs[reserveIn];
      const prevStamps = prev.token?.amount ?? 0n;
      const customer = tx.outputs.map((o, i) => (i === reserveIn ? undefined : p2pkhOwner(o.lockingBytecode))).find(Boolean);
      return { ...base, kind: 'redeem', stamps: (next.token?.amount ?? 0n) - prevStamps, sats: prev.valueSatoshis - next.valueSatoshis, customer };
    }
    const toReserve = tx.outputs.filter((_, i) => locks[i] === reserveLock).reduce((s, o) => s + o.valueSatoshis, 0n);
    const minted = tx.outputs.filter((o, i) => locks[i] === issuerLock && isStamp(o)).reduce((s, o) => s + o.token!.amount, 0n);
    if (minted > 0n) return { ...base, kind: 'open', stamps: minted, sats: toReserve };
    if (toReserve > 0n) return { ...base, kind: 'fund', stamps: 0n, sats: toReserve };
    return undefined;
  });
  return events.filter((e): e is ShopEvent => Boolean(e)).sort((a, b) => b.time - a.time);
}

export { statsOf, type ShopStats } from './stats';

export interface Bucket { label: string; start: number; value: number }

/** Sum `value` per day over the last `days` days (oldest first). */
export function daily(events: ShopEvent[], days: number, value: (e: ShopEvent) => number): Bucket[] {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const buckets: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(startOfToday); day.setDate(day.getDate() - i);
    buckets.push({ label: day.toLocaleDateString('en-US', days > 14 ? { day: 'numeric' } : { weekday: 'short' }), start: day.getTime() / 1000, value: 0 });
  }
  for (const e of events) {
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (e.time >= buckets[i].start) { buckets[i].value += value(e); break; }
    }
  }
  return buckets;
}
