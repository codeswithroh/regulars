// Everything that touches the chain on behalf of the connected wallet.
import { ElectrumNetworkProvider, TransactionBuilder, placeholderP2PKHUnlocker, type SpendableUtxo } from 'cashscript';
import { hash160, encodeCashAddress, stringify } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { makeReserve, buildRedeem, BCH_DUST, PLACEHOLDER_INPUT_BYTES } from '@regulars/contracts';
import { network, prefix, merchant, reserveParams } from './config';

// One long-lived Electrum connection for the page, rather than a new socket per request.
export const provider = new ElectrumNetworkProvider(network, { manualConnectionManagement: true });
let connecting: Promise<void> | undefined;
const online = () => (connecting ??= provider.connect().catch((error) => { connecting = undefined; throw error; }));

export const reserve = () => makeReserve(reserveParams, provider);

/** Ask the shop to send stamps for a payment (or for any unrewarded payment). Safe to repeat. */
export async function requestStamps(txid?: string): Promise<{ stamps: string; txid: string }[]> {
  try {
    const response = await fetch(`/api/issue${txid ? `?txid=${txid}` : ''}`, { method: 'POST' });
    if (!response.ok) return [];
    return (await response.json()).issued ?? [];
  } catch {
    // Unreachable shop: the payment is still on-chain and is rewarded on the next request.
    return [];
  }
}

/** How many addresses to look at on each of the wallet's receive and change paths. */
const ADDRESSES_PER_PATH = 10;
const PATHS = [{ name: 'receive', child: 0 }, { name: 'change', child: 1 }] as const;

interface WalletUtxo extends SpendableUtxo {
  address: string;
  tokenAddress: string;
  path: string;
  index: number;
}

export interface WalletState {
  bch: bigint;
  stamps: bigint;
  utxos: WalletUtxo[];
}

export async function readWallet(manager: DappConnectionManager): Promise<WalletState> {
  await online();
  const lookups: Promise<WalletUtxo[]>[] = [];
  for (const path of PATHS) {
    for (let index = 0; index < ADDRESSES_PER_PATH; index++) {
      const pubkey = manager.getPubkey(path.child, BigInt(index));
      if (!pubkey) continue;
      const payload = hash160(pubkey);
      const address = encodeCashAddress({ prefix, type: 'p2pkh', payload, throwErrors: true }).address;
      const tokenAddress = encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload, throwErrors: true }).address;
      lookups.push(provider.getUtxos(address).then((utxos) =>
        utxos.map((utxo) => ({ ...utxo, address, tokenAddress, path: path.name, index }))));
    }
  }
  const utxos = (await Promise.all(lookups)).flat();
  const isStamp = (u: WalletUtxo) => u.token?.category === reserveParams.stampCategory && !u.token.nft;
  return {
    utxos,
    bch: utxos.filter((u) => !u.token).reduce((sum, u) => sum + u.satoshis, 0n),
    stamps: utxos.filter(isStamp).reduce((sum, u) => sum + u.token!.amount, 0n),
  };
}

export interface ReserveState {
  sats: bigint;
  utxo?: SpendableUtxo;
}

export async function readReserve(): Promise<ReserveState> {
  await online();
  const utxos = await reserve().getUtxos();
  const largest = [...utxos].sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  return { sats: utxos.reduce((sum, u) => sum + u.satoshis, 0n), utxo: largest };
}

async function signAndSend(
  manager: DappConnectionManager,
  builder: TransactionBuilder,
  inputPaths: [number, string, number][],
  userPrompt: string,
): Promise<string> {
  // The wallet only signs; we broadcast, so behaviour does not depend on the wallet.
  await online();
  // The relay carries JSON, so bigints and byte arrays travel in libauth's extended-JSON form
  // (`<bigint: 1n>`, `<Uint8Array: 0x…>`), the same encoding BCH WalletConnect wallets parse.
  const transaction = JSON.parse(stringify(builder.generateWcTransactionObject({ broadcast: false, userPrompt })));
  const response = await manager.signTransaction({ transaction, inputPaths });
  if (response.error) throw new Error(response.error);
  return provider.sendRawTransaction(response.signedTransaction);
}

/** Plain BCH payment to the merchant. Stamps come back to the address of the first input. */
export async function payMerchant(manager: DappConnectionManager, wallet: WalletState, sats: bigint): Promise<string> {
  const coins = wallet.utxos.filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
  const chosen: WalletUtxo[] = [];
  let total = 0n;
  const feeFor = (inputs: number) => BigInt(inputs) * (41n + PLACEHOLDER_INPUT_BYTES) + 2n * 34n + 20n;
  for (const coin of coins) {
    chosen.push(coin);
    total += coin.satoshis;
    if (total >= sats + feeFor(chosen.length) + BCH_DUST) break;
  }
  const fee = feeFor(chosen.length);
  if (total < sats + fee) throw new Error(`Wallet holds ${wallet.bch} sats, not enough to pay ${sats} plus the fee`);

  const builder = new TransactionBuilder({ provider });
  chosen.forEach((coin) => builder.addInput(coin, placeholderP2PKHUnlocker(coin.address)));
  builder.addOutput({ to: merchant.address, amount: sats });
  const change = total - sats - fee;
  if (change >= BCH_DUST) builder.addOutput({ to: chosen[0].address, amount: change });

  const inputPaths = chosen.map((coin, i) => [i, coin.path, coin.index] as [number, string, number]);
  return signAndSend(manager, builder, inputPaths, `Pay ${sats} sats to ${merchant.name}`);
}

/** Hand stamps to the reserve covenant and take the BCH they are worth. */
export async function redeemStamps(
  manager: DappConnectionManager,
  wallet: WalletState,
  reserveState: ReserveState,
  stamps: bigint,
): Promise<{ txid: string; payout: bigint }> {
  if (!reserveState.utxo) throw new Error('The reward reserve is empty');
  const held = wallet.utxos
    .filter((u) => u.token?.category === reserveParams.stampCategory && !u.token.nft)
    .sort((a, b) => Number(b.token!.amount - a.token!.amount));
  const chosen: WalletUtxo[] = [];
  let gathered = 0n;
  for (const utxo of held) {
    if (gathered >= stamps) break;
    chosen.push(utxo);
    gathered += utxo.token!.amount;
  }

  const { builder, plan } = buildRedeem({
    reserve: reserve(),
    params: reserveParams,
    reserveUtxo: reserveState.utxo,
    stampInputs: chosen.map((utxo) => ({ utxo, unlocker: placeholderP2PKHUnlocker(utxo.address) })),
    stamps,
    customerAddress: chosen[0]?.address ?? '',
    customerTokenAddress: chosen[0]?.tokenAddress ?? '',
    provider,
  });
  // Input 0 is the reserve, which needs no signature; the wallet signs the stamp inputs after it.
  const inputPaths = chosen.map((utxo, i) => [i + 1, utxo.path, utxo.index] as [number, string, number]);
  const txid = await signAndSend(manager, builder, inputPaths, `Redeem ${stamps} stamps for ${plan.payout} sats`);
  return { txid, payout: plan.payout };
}
