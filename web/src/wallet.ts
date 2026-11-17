// Everything that touches the chain. There is no backend: the page talks to an Electrum server
// and asks the connected wallet to sign.
import { TransactionBuilder, placeholderP2PKHUnlocker, placeholderPublicKey, placeholderSignature, type SpendableUtxo } from 'cashscript';
import { hash160, encodeCashAddress, stringify, binToHex, hexToBin } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { makeIssuer, makeReserve, buildCreateShop, buildEarn, buildRedeem, buildCloseShop, FailoverProvider, BCH_DUST, PLACEHOLDER_INPUT_BYTES, type Shop, type Coin } from '@regulars/contracts';
import { commitmentScript } from '@regulars/bch-nostr-id';
import { network, prefix, protocol } from './config';

// One connection for the page, with automatic failover across several Electrum servers.
export const provider = new FailoverProvider(network);
export const online = () => provider.ready();

/** How many addresses to look at on each of the wallet's receive and change paths. */
const ADDRESSES_PER_PATH = 10;
const PATHS = [{ name: 'receive', child: 0 }, { name: 'change', child: 1 }] as const;

export interface WalletUtxo extends SpendableUtxo { address: string; tokenAddress: string; path: string; index: number }
export interface WalletState { bch: bigint; utxos: WalletUtxo[] }

const addressesOf = (pubkey: Uint8Array) => {
  const payload = hash160(pubkey);
  const of = (type: 'p2pkh' | 'p2pkhWithTokens') => encodeCashAddress({ prefix, type, payload, throwErrors: true }).address;
  return { address: of('p2pkh'), tokenAddress: of('p2pkhWithTokens'), pkh: binToHex(payload) };
};

/** hash160s (hex) of the wallet addresses this site looks at. */
export function walletPkhs(manager: DappConnectionManager): Set<string> {
  const pkhs = new Set<string>();
  for (const path of PATHS) {
    for (let index = 0; index < ADDRESSES_PER_PATH; index++) {
      const pubkey = manager.getPubkey(path.child, BigInt(index));
      if (pubkey) pkhs.add(binToHex(hash160(pubkey)));
    }
  }
  return pkhs;
}

/** The address payments to a shop opened from this wallet would go to. */
export function primaryPkh(manager: DappConnectionManager): string | undefined {
  const pubkey = manager.getPubkey(0, 0n);
  return pubkey ? binToHex(hash160(pubkey)) : undefined;
}

export async function readWallet(manager: DappConnectionManager): Promise<WalletState> {
  await online();
  const lookups: Promise<WalletUtxo[]>[] = [];
  for (const path of PATHS) {
    for (let index = 0; index < ADDRESSES_PER_PATH; index++) {
      const pubkey = manager.getPubkey(path.child, BigInt(index));
      if (!pubkey) continue;
      const { address, tokenAddress } = addressesOf(pubkey);
      lookups.push(provider.getUtxos(address).then((utxos) => utxos.map((utxo) => ({ ...utxo, address, tokenAddress, path: path.name, index }))));
    }
  }
  const utxos = (await Promise.all(lookups)).flat();
  return { utxos, bch: utxos.filter((u) => !u.token).reduce((sum, u) => sum + u.satoshis, 0n) };
}

const isStamp = (u: SpendableUtxo, shop: Shop) => u.token?.category === shop.category && !u.token.nft;
export const stampsHeld = (wallet: WalletState | undefined, shop: Shop) =>
  (wallet?.utxos ?? []).filter((u) => isStamp(u, shop)).reduce((sum, u) => sum + u.token!.amount, 0n);

export interface ShopState {
  /** BCH locked in the reward reserve. */
  reserve: bigint;
  reserveUtxo?: SpendableUtxo;
  reserves: SpendableUtxo[];
  /** Stamps the shop can still give out. */
  stampsLeft: bigint;
  /** Stamps customers have redeemed so far. */
  redeemed: bigint;
  issuers: SpendableUtxo[];
}

export async function readShop(shop: Shop): Promise<ShopState> {
  await online();
  const [issuers, reserves] = await Promise.all([makeIssuer(shop, protocol, provider).getUtxos(), makeReserve(shop, provider).getUtxos()]);
  const live = issuers.filter((u) => isStamp(u, shop));
  return {
    issuers: live,
    stampsLeft: live.reduce((sum, u) => sum + u.token!.amount, 0n),
    reserve: reserves.reduce((sum, u) => sum + u.satoshis, 0n),
    reserves,
    reserveUtxo: [...reserves].sort((a, b) => Number(b.satoshis - a.satoshis))[0],
    redeemed: reserves.reduce((sum, u) => sum + (isStamp(u, shop) ? u.token!.amount : 0n), 0n),
  };
}

const asCoin = (utxo: WalletUtxo): Coin => ({ utxo, unlocker: placeholderP2PKHUnlocker(utxo.address) });
const pathOf = (utxo: WalletUtxo, inputIndex: number) => [inputIndex, utxo.path, utxo.index] as [number, string, number];

async function signAndSend(manager: DappConnectionManager, builder: TransactionBuilder, inputPaths: [number, string, number][], userPrompt: string) {
  await online();
  // The relay carries JSON, so bigints and byte arrays travel in libauth's extended-JSON form
  // (`<bigint: 1n>`, `<Uint8Array: 0x…>`), the same encoding BCH WalletConnect wallets parse.
  const transaction = JSON.parse(stringify(builder.generateWcTransactionObject({ broadcast: false, userPrompt })));
  const response = await manager.signTransaction({ transaction, inputPaths });
  if (response.error) throw new Error(response.error);
  // The wallet only signs; the page broadcasts, so behaviour does not depend on the wallet.
  try {
    return await provider.sendRawTransaction(response.signedTransaction);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/conflict|missing|spent/i.test(text)) throw new Error('Another payment landed at the same moment. Nothing was charged; please try again.');
    throw error;
  }
}

/** Largest-first plain coins covering `needed` plus a per-input fee allowance. */
function pickCoins(wallet: WalletState, needed: bigint, exclude?: WalletUtxo): WalletUtxo[] {
  const chosen: WalletUtxo[] = [];
  let sum = 0n;
  for (const coin of wallet.utxos.filter((u) => !u.token && u !== exclude).sort((a, b) => Number(b.satoshis - a.satoshis))) {
    if (sum >= needed + BigInt(chosen.length) * (41n + PLACEHOLDER_INPUT_BYTES) + BCH_DUST) break;
    chosen.push(coin);
    sum += coin.satoshis;
  }
  return chosen;
}

function planEarn(wallet: WalletState, shop: Shop, state: ShopState, pay: bigint) {
  const usable = state.issuers.filter((u) => u.token!.amount > pay / shop.earn);
  if (!usable.length) throw new Error('This shop has run out of stamps to give');
  // Issuer outputs are interchangeable; a random pick keeps simultaneous customers apart.
  const issuerUtxo = usable[Math.floor(Math.random() * usable.length)];
  const coins = pickCoins(wallet, pay + 2000n);
  if (!coins.length) throw new Error(`Your wallet holds ${wallet.bch} sats, not enough to pay ${pay}`);
  const built = buildEarn({
    shop, protocol, issuerUtxo, coins: coins.map(asCoin), pay,
    customerAddress: coins[0].address, customerTokenAddress: coins[0].tokenAddress, provider,
  });
  return { ...built, coins };
}

/** What paying would cost, without asking the wallet for anything. */
export function previewEarn(wallet: WalletState, shop: Shop, state: ShopState, pay: bigint) {
  try { return planEarn(wallet, shop, state, pay).plan; } catch { return undefined; }
}

/** Pay the shop and receive the stamps in the same transaction. */
export async function payAndEarn(manager: DappConnectionManager, wallet: WalletState, shop: Shop, state: ShopState, pay: bigint) {
  const { builder, plan, coins } = planEarn(wallet, shop, state, pay);
  // Input 0 is the issuer contract, which needs no signature.
  const txid = await signAndSend(manager, builder, coins.map((c, i) => pathOf(c, i + 1)), `Pay ${pay} sats to ${shop.name} and earn ${plan.stamps} stamps`);
  return { txid, plan };
}

function planRedeem(wallet: WalletState, shop: Shop, state: ShopState) {
  if (!state.reserveUtxo) throw new Error('The reward reserve is empty');
  const held = wallet.utxos.filter((u) => isStamp(u, shop));
  const stamps = held.reduce((sum, u) => sum + u.token!.amount, 0n);
  if (stamps === 0n) throw new Error('No stamps to redeem yet');
  const built = buildRedeem({
    shop, reserveUtxo: state.reserveUtxo, stampInputs: held.map(asCoin), stamps,
    customerAddress: held[0].address, customerTokenAddress: held[0].tokenAddress, provider,
  });
  return { ...built, held, deposit: held.reduce((sum, u) => sum + u.satoshis, 0n) };
}

/** What redeeming every stamp would return, without asking the wallet for anything. */
export function previewRedeem(wallet: WalletState, shop: Shop, state: ShopState) {
  try { const { plan, deposit } = planRedeem(wallet, shop, state); return { ...plan, deposit }; } catch { return undefined; }
}

/** Hand every stamp held to the reserve and take the BCH. */
export async function redeemStamps(manager: DappConnectionManager, wallet: WalletState, shop: Shop, state: ShopState) {
  const { builder, plan, held } = planRedeem(wallet, shop, state);
  const txid = await signAndSend(manager, builder, held.map((u, i) => pathOf(u, i + 1)), `Redeem ${plan.stamps} stamps for ${plan.payout} sats`);
  return { txid, plan };
}

/** Add BCH to a shop's reward reserve. Anyone can do this; the shop cannot take it back except by closing. */
export async function fundReserve(manager: DappConnectionManager, wallet: WalletState, shop: Shop, amount: bigint) {
  const coins = pickCoins(wallet, amount + 1000n);
  const total = coins.reduce((s, c) => s + c.satoshis, 0n);
  const fee = BigInt(coins.length) * (41n + PLACEHOLDER_INPUT_BYTES) + 2n * 44n + 20n;
  if (total < amount + fee) throw new Error(`Your wallet holds ${wallet.bch} sats, not enough to add ${amount}`);
  const builder = new TransactionBuilder({ provider });
  coins.forEach((c) => builder.addInput(c, placeholderP2PKHUnlocker(c.address)));
  builder.addOutput({ to: makeReserve(shop, provider).address, amount });
  const change = total - amount - fee;
  if (change >= BCH_DUST) builder.addOutput({ to: coins[0].address, amount: change });
  return signAndSend(manager, builder, coins.map(pathOf), `Add ${amount} sats to the ${shop.name} reward reserve`);
}

export interface NewShop { name: string; earn: bigint; redeem: bigint; reserveSats: bigint; supply: bigint }

/**
 * Open a shop from the connected wallet. Payments will go to the wallet's first receive address.
 * Needs one signature, or two when the wallet has no coin that can seed a new token.
 */
export async function openShop(manager: DappConnectionManager, input: NewShop, onStep: (text: string) => void): Promise<{ shop: Shop; txid: string }> {
  const pubkey = manager.getPubkey(0, 0n);
  if (!pubkey) throw new Error('Wallet is not ready yet');
  const merchant = addressesOf(pubkey);
  let wallet = await readWallet(manager);
  const needed = input.reserveSats + 8n * 1000n + 2000n;
  if (wallet.bch < needed) throw new Error(`Opening this shop needs about ${needed} sats; your wallet holds ${wallet.bch}`);

  // A token's category is the txid of a spent output with index 0.
  let genesis = wallet.utxos.find((u) => !u.token && u.vout === 0);
  if (!genesis) {
    onStep('Step 1 of 2: approve a small preparation transaction in your wallet…');
    const coins = pickCoins(wallet, needed);
    const sum = coins.reduce((s, c) => s + c.satoshis, 0n);
    const fee = BigInt(coins.length) * (41n + PLACEHOLDER_INPUT_BYTES) + 60n;
    const prepare = new TransactionBuilder({ provider });
    coins.forEach((c) => prepare.addInput(c, placeholderP2PKHUnlocker(c.address)));
    prepare.addOutput({ to: merchant.address, amount: sum - fee });
    const txid = await signAndSend(manager, prepare, coins.map(pathOf), 'Prepare a coin to mint your stamps');
    for (let attempt = 0; attempt < 10 && !genesis; attempt++) {
      wallet = await readWallet(manager);
      genesis = wallet.utxos.find((u) => u.txid === txid && u.vout === 0);
      if (!genesis) await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (!genesis) throw new Error('The preparation transaction is not visible yet. Please try again in a moment.');
    onStep('Step 2 of 2: approve opening the shop in your wallet…');
  } else {
    onStep('Approve opening the shop in your wallet…');
  }

  const extra = genesis.satoshis >= needed ? [] : pickCoins(wallet, needed - genesis.satoshis, genesis);
  const inputs = [genesis, ...extra];
  const { builder, shop } = buildCreateShop({
    genesis: asCoin(genesis), coins: extra.map(asCoin),
    name: input.name, merchantPkh: merchant.pkh, earn: input.earn, redeem: input.redeem,
    protocol, supply: input.supply, issuerOutputs: 8, reserveSats: input.reserveSats,
    changeAddress: merchant.address, provider,
  });
  const txid = await signAndSend(manager, builder, inputs.map(pathOf), `Open "${input.name}": mint stamps and fund a ${input.reserveSats}-sat reward reserve`);
  return { shop, txid };
}

/** Where in the connected wallet the key with this hash160 lives, if it is one of the addresses this site reads. */
function pathOfPkh(manager: DappConnectionManager, pkh: string): { path: string; index: number } | undefined {
  for (const path of PATHS) {
    for (let index = 0; index < ADDRESSES_PER_PATH; index++) {
      const pubkey = manager.getPubkey(path.child, BigInt(index));
      if (pubkey && binToHex(hash160(pubkey)) === pkh) return { path: path.name, index };
    }
  }
  return undefined;
}

/** True when the connected wallet holds the shop's key, and so can close it. */
export const ownsShop = (manager: DappConnectionManager | undefined, shop: Shop) => Boolean(manager && pathOfPkh(manager, shop.merchantPkh));

function planClose(shop: Shop, state: ShopState, merchantAddress = '') {
  return buildCloseShop({
    shop, protocol, issuers: state.issuers, reserves: state.reserves,
    merchantPk: placeholderPublicKey(), merchantSig: placeholderSignature(),
    merchantAddress: merchantAddress || encodeCashAddress({ prefix, type: 'p2pkh', payload: hexToBin(shop.merchantPkh), throwErrors: true }).address,
    provider,
  });
}

/** What closing would return and burn, without asking the wallet for anything. */
export function previewClose(shop: Shop, state: ShopState) {
  try { const { builders, plan } = planClose(shop, state); return { ...plan, approvals: builders.length }; } catch { return undefined; }
}

/**
 * Close a shop: take back the reward reserve and retire every issuer output, burning the stamps
 * left in them. Each issuer output is its own transaction, so the wallet is asked once per output.
 */
export async function closeShop(manager: DappConnectionManager, shop: Shop, state: ShopState, onStep: (text: string) => void) {
  const key = pathOfPkh(manager, shop.merchantPkh);
  if (!key) throw new Error('Only the wallet that opened this shop can close it');
  const { builders, plan } = planClose(shop, state);
  const txids: string[] = [];
  for (const [n, builder] of builders.entries()) {
    onStep(`Approve ${n + 1} of ${builders.length} in your wallet…`);
    // Every input is a shop contract that needs the shop key's signature; the wallet fills in the placeholders.
    const paths = builder.inputs.map((_, i) => [i, key.path, key.index] as [number, string, number]);
    txids.push(await signAndSend(manager, builder, paths, `Close "${shop.name}" (${n + 1} of ${builders.length}): ${n === 0 && state.reserves.length ? 'take back the reward reserve and ' : ''}retire unissued stamps`));
  }
  return { txids, plan };
}

/** The address a wallet's on-chain identity commitment is spent from: receive/0 when it holds a coin, else the largest coin's. */
export function commitmentCoin(wallet: WalletState): WalletUtxo | undefined {
  const plain = wallet.utxos.filter((u) => !u.token && u.satoshis >= 1500n).sort((a, b) => Number(b.satoshis - a.satoshis));
  return plain.find((u) => u.path === 'receive' && u.index === 0) ?? plain[0];
}

/**
 * Prove control of an address to a Nostr key by spending one of its coins back to itself with the
 * NIP-39 verification text in an OP_RETURN output. Costs only the network fee (about 300 sats).
 */
export async function commitIdentity(manager: DappConnectionManager, wallet: WalletState, text: string) {
  const coin = commitmentCoin(wallet);
  if (!coin) throw new Error('Your wallet needs a coin of at least 1,500 sats to commit an identity');
  const script = commitmentScript(text);
  const fee = 41n + PLACEHOLDER_INPUT_BYTES + 34n + BigInt(9 + script.length) + 30n;
  const builder = new TransactionBuilder({ provider });
  builder.addInput(coin, placeholderP2PKHUnlocker(coin.address));
  builder.addOutput({ to: script, amount: 0n });
  builder.addOutput({ to: coin.address, amount: coin.satoshis - fee });
  const txid = await signAndSend(manager, builder, [pathOf(coin, 0)], 'Link this address to your Nostr identity (no BCH leaves your wallet)');
  return { txid, address: coin.address };
}

/** Send plain BCH to an address (used to pay someone by their verified identity). */
export async function sendBch(manager: DappConnectionManager, wallet: WalletState, to: string, amount: bigint, prompt: string) {
  const coins = pickCoins(wallet, amount + 1000n);
  const total = coins.reduce((s, c) => s + c.satoshis, 0n);
  const fee = BigInt(coins.length) * (41n + PLACEHOLDER_INPUT_BYTES) + 2n * 44n + 20n;
  if (total < amount + fee) throw new Error(`Your wallet holds ${wallet.bch} sats, not enough to send ${amount}`);
  const builder = new TransactionBuilder({ provider });
  coins.forEach((c) => builder.addInput(c, placeholderP2PKHUnlocker(c.address)));
  builder.addOutput({ to, amount });
  const change = total - amount - fee;
  if (change >= BCH_DUST) builder.addOutput({ to: coins[0].address, amount: change });
  return signAndSend(manager, builder, coins.map(pathOf), prompt);
}

/** Raw transaction hex by id, for checking on-chain identity commitments. */
export const fetchTx = async (txid: string) => { await online(); return provider.getRawTransaction(txid); };

/** Stamp balances an address holds, by token category. */
export async function tokensAt(address: string): Promise<Map<string, bigint>> {
  await online();
  const held = new Map<string, bigint>();
  for (const u of await provider.getUtxos(address)) if (u.token && !u.token.nft) held.set(u.token.category, (held.get(u.token.category) ?? 0n) + u.token.amount);
  return held;
}
