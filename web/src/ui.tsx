// Shared hooks: wallet connection, live chain state, known shops, actions.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { UseWizardConnectResult } from '@wizardconnect/react';
import { parseShopPath, shopPath, type Shop } from '@regulars/contracts';
import { demoShop } from './config';
import { primaryPkh, readShop, readWallet, walletPkhs, type ShopState, type WalletState } from './wallet';
import { shopHistory, type ShopEvent } from './history';
import type { Notice } from './components/kit';

export const WalletContext = createContext<UseWizardConnectResult>(null!);
export const useWalletConnection = () => useContext(WalletContext);
export const go = (path: string) => { window.location.hash = path; };
export const keyOf = (shop: Shop) => shopPath(shop);

/** Poll an async source; keeps the last good value across refreshes. */
function usePoll<T>(load: (() => Promise<T>) | undefined, ms: number, deps: unknown[]) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(Boolean(load));
  const refresh = useCallback(async () => {
    if (!load) { setValue(undefined); setLoading(false); return undefined; }
    try {
      const next = await load();
      setValue(next); setError(undefined);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    setLoading(Boolean(load));
    refresh();
    if (!load) return;
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [refresh, ms]);
  return { value, error, loading, refresh };
}

export function useWallet() {
  const wc = useWalletConnection();
  const manager = wc.state === 'connected' ? wc.manager : null;
  const poll = usePoll<WalletState>(manager ? () => readWallet(manager) : undefined, 6000, [manager]);
  const pkhs = useMemo(() => (manager ? walletPkhs(manager) : new Set<string>()), [manager]);
  return { manager, wallet: poll.value, pkhs, primary: manager ? primaryPkh(manager) : undefined, refresh: poll.refresh, loading: poll.loading };
}

export function useShopState(shop: Shop | undefined) {
  const poll = usePoll<ShopState>(shop ? () => readShop(shop) : undefined, 8000, [shop && keyOf(shop)]);
  return { state: poll.value, error: poll.error, refresh: poll.refresh };
}

export function useHistory(shop: Shop | undefined) {
  const poll = usePoll<ShopEvent[]>(shop ? () => shopHistory(shop) : undefined, 20000, [shop && keyOf(shop)]);
  return { events: poll.value, loading: poll.loading, refresh: poll.refresh };
}

export type TaggedEvent = ShopEvent & { shop: Shop };
export function useHistories(shops: Shop[]) {
  const key = shops.map(keyOf).join('|');
  const poll = usePoll<TaggedEvent[]>(shops.length ? async () => {
    const lists = await Promise.all(shops.map(async (shop) => (await shopHistory(shop).catch(() => [])).map((e) => ({ ...e, shop }))));
    return lists.flat().sort((a, b) => b.time - a.time);
  } : undefined, 20000, [key]);
  return { events: poll.value, loading: poll.loading, refresh: poll.refresh };
}

// Shops this browser knows about. A shop is fully described by its link, so these are just links.
const VISITED = 'regulars-shops';
const MINE = 'regulars-my-shops';
const readList = (key: string): string[] => { try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; } };
const writeList = (key: string, list: string[]) => { try { localStorage.setItem(key, JSON.stringify(list.slice(0, 30))); } catch { /* private window */ } window.dispatchEvent(new Event('regulars-shops')); };
export const rememberShop = (shop: Shop) => { const p = keyOf(shop); writeList(VISITED, [p, ...readList(VISITED).filter((x) => x !== p)]); };
export const rememberMine = (shop: Shop) => { const p = keyOf(shop); writeList(MINE, [p, ...readList(MINE).filter((x) => x !== p)]); rememberShop(shop); };

export function useKnownShops(primary?: string) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('regulars-shops', bump); window.addEventListener('storage', bump);
    return () => { window.removeEventListener('regulars-shops', bump); window.removeEventListener('storage', bump); };
  }, []);
  return useMemo(() => {
    const parse = (paths: string[]) => paths.map(parseShopPath).filter((s): s is Shop => Boolean(s));
    const all = new Map<string, Shop>();
    for (const s of [...(demoShop ? [demoShop] : []), ...parse(readList(MINE)), ...parse(readList(VISITED))]) all.set(keyOf(s), s);
    const minePaths = new Set(readList(MINE));
    const mine = [...all.values()].filter((s) => minePaths.has(keyOf(s)) || (primary && s.merchantPkh === primary));
    return { all: [...all.values()], mine };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, primary]);
}

/** Run a wallet action with busy / done / failed feedback. */
export function useAction(afterwards?: () => Promise<unknown>) {
  const [notice, setNotice] = useState<Notice>();
  const run = async (busy: string, work: (say: (n: Notice) => void) => Promise<Notice>) => {
    setNotice({ kind: 'busy', text: busy });
    try {
      const result = await work(setNotice);
      await afterwards?.();
      setNotice(result);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };
  return { notice, run, busy: notice?.kind === 'busy', clear: () => setNotice(undefined) };
}

export const stampsOf = (wallet: WalletState | undefined, shop: Shop) =>
  (wallet?.utxos ?? []).filter((u) => u.token?.category === shop.category && !u.token.nft).reduce((s, u) => s + u.token!.amount, 0n);
