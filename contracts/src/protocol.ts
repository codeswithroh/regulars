// Transaction builders shared by the web app, the CLI and the tests. Callers pass unlockers:
// real signature templates on a server or in tests, wallet placeholders in the browser.
import { Contract, TransactionBuilder, type NetworkProvider, type SpendableUtxo, type Unlocker } from 'cashscript';
import { binToHex, hexToBin } from '@bitauth/libauth';
import reserveArtifact from '../artifacts/RewardReserve.artifact.js';
import issuerArtifact from '../artifacts/StampIssuer.artifact.js';

export { reserveArtifact, issuerArtifact };

import type { Shop } from './links.js';
export type { Shop } from './links.js';

/** Protocol-wide settings, the same for every shop. */
export interface Protocol {
  /** Sats per stamp issued, taken out of the shop's side of each payment. */
  feePerStamp: bigint;
  /** hash160 of the protocol treasury key (hex). */
  protocolPkh: string;
}

export type Coin = { utxo: SpendableUtxo; unlocker: Unlocker };

/** Smallest values the network relays for token-carrying and plain outputs. */
export const TOKEN_DUST = 1000n;
export const BCH_DUST = 546n;
/** Bytes a wallet adds when it signs a P2PKH input (signature + key, with slack for ECDSA). */
export const PLACEHOLDER_INPUT_BYTES = 110n;
const CHANGE_OUTPUT_BYTES = 40n;

// Script introspection sees a token category in the opposite byte order from wallets.
const unreversed = (category: string) => binToHex(hexToBin(category).reverse());
const p2pkh = (pkh: string) => hexToBin(`76a914${pkh}88ac`);
const isStamps = (utxo: SpendableUtxo, shop: Shop) => utxo.token?.category === shop.category && !utxo.token.nft;

export const makeIssuer = (shop: Shop, protocol: Protocol, provider: NetworkProvider) =>
  new Contract(issuerArtifact, [unreversed(shop.category), shop.earn, shop.merchantPkh, protocol.feePerStamp, protocol.protocolPkh], { provider });

export const makeReserve = (shop: Shop, provider: NetworkProvider) =>
  new Contract(reserveArtifact, [unreversed(shop.category), shop.redeem, shop.merchantPkh], { provider });

/** Build once with a throwaway fee to learn the size, then again with the real fee. */
function withFee(assemble: (fee: bigint) => TransactionBuilder, probeFee: bigint, coins: Coin[], probeHasAllOutputs = false, feePerByte = 1n) {
  if (probeFee < 0n) assemble(0n); // not enough funds: let the builder raise its own clear message
  const unsigned = BigInt(coins.filter(({ unlocker }) => 'placeholder' in unlocker).length);
  // A probe that spends everything as fee has no change output; allow for one unless it already has every output.
  const size = BigInt(assemble(probeFee).build().length / 2) + unsigned * PLACEHOLDER_INPUT_BYTES + (probeHasAllOutputs ? 0n : CHANGE_OUTPUT_BYTES);
  const fee = size * feePerByte + 10n;
  return { builder: assemble(fee), fee };
}

const total = (coins: Coin[]) => coins.reduce((sum, { utxo }) => sum + utxo.satoshis, 0n);

/**
 * Open a shop in one transaction: mint the stamps straight into issuer contracts and fund the
 * reward reserve. A token's category is the txid of the output-0 coin spent as input 0, so
 * `genesis` must be an output with index 0.
 */
export function buildCreateShop(opts: {
  genesis: Coin;
  coins: Coin[];
  name: string;
  merchantPkh: string;
  earn: bigint;
  redeem: bigint;
  protocol: Protocol;
  supply: bigint;
  /** The supply is split over this many issuer outputs so simultaneous customers do not queue. */
  issuerOutputs: number;
  reserveSats: bigint;
  changeAddress: string;
  provider: NetworkProvider;
}) {
  if (opts.genesis.utxo.vout !== 0 || opts.genesis.utxo.token) throw new Error('The genesis coin must be a plain output with index 0');
  if (opts.earn <= opts.protocol.feePerStamp) throw new Error('Sats per stamp must exceed the protocol fee');
  if (opts.redeem <= 0n || opts.redeem >= opts.earn) throw new Error('Reward per stamp must be positive and below the earn rate');
  const count = BigInt(opts.issuerOutputs);
  if (count < 1n || opts.supply < count * 2n) throw new Error('Supply is too small for that many issuer outputs');
  if (opts.reserveSats < TOKEN_DUST) throw new Error(`The reserve needs at least ${TOKEN_DUST} sats`);

  const shop: Shop = { name: opts.name, category: opts.genesis.utxo.txid, merchantPkh: opts.merchantPkh, earn: opts.earn, redeem: opts.redeem };
  const issuer = makeIssuer(shop, opts.protocol, opts.provider);
  const reserve = makeReserve(shop, opts.provider);
  const inputs = [opts.genesis, ...opts.coins];
  const spend = TOKEN_DUST * count + opts.reserveSats;

  const assemble = (fee: bigint) => {
    const change = total(inputs) - spend - fee;
    if (change < 0n) throw new Error(`Opening this shop needs ${spend + fee} sats; the selected coins hold ${total(inputs)}`);
    const builder = new TransactionBuilder({ provider: opts.provider });
    inputs.forEach(({ utxo, unlocker }) => builder.addInput(utxo, unlocker));
    for (let i = 0n; i < count; i++) {
      const amount = opts.supply / count + (i === 0n ? opts.supply % count : 0n);
      builder.addOutput({ to: issuer.tokenAddress, amount: TOKEN_DUST, token: { category: shop.category, amount } });
    }
    builder.addOutput({ to: reserve.address, amount: opts.reserveSats });
    return change >= BCH_DUST ? builder.addOutput({ to: opts.changeAddress, amount: change }) : builder;
  };
  // Probe with whatever is left over as the fee, which is always a valid transaction.
  return { ...withFee(assemble, total(inputs) - spend, inputs), shop };
}

export interface EarnPlan {
  stamps: bigint;
  /** What the customer pays for goods. */
  pay: bigint;
  merchantGets: bigint;
  protocolFee: bigint;
  /** Network fee. */
  fee: bigint;
  /** Total leaving the customer's coins: payment + the stamp output's own sats + network fee. */
  cost: bigint;
}

/** Pay the shop and take the stamps earned, atomically. */
export function buildEarn(opts: {
  shop: Shop;
  protocol: Protocol;
  issuerUtxo: SpendableUtxo;
  coins: Coin[];
  pay: bigint;
  customerAddress: string;
  customerTokenAddress: string;
  provider: NetworkProvider;
}): { builder: TransactionBuilder; plan: EarnPlan } {
  const { shop, protocol, issuerUtxo, coins, pay } = opts;
  if (!isStamps(issuerUtxo, shop)) throw new Error('That is not one of this shop\'s issuer outputs');
  const stamps = pay / shop.earn;
  if (stamps < 1n) throw new Error(`Pay at least ${shop.earn} sats to earn a stamp`);
  if (stamps >= issuerUtxo.token!.amount) throw new Error('This shop has run out of stamps to give');

  const issuer = makeIssuer(shop, protocol, opts.provider);
  const protocolFee = stamps * protocol.feePerStamp;
  const merchantGets = pay - protocolFee;

  const assemble = (fee: bigint) => {
    const change = total(coins) - pay - TOKEN_DUST - fee;
    if (change < 0n) throw new Error(`Paying ${pay} sats needs ${pay + TOKEN_DUST + fee} in total; the wallet's coins hold ${total(coins)}`);
    const builder = new TransactionBuilder({ provider: opts.provider }).addInput(issuerUtxo, issuer.unlock.earn());
    coins.forEach(({ utxo, unlocker }) => builder.addInput(utxo, unlocker));
    builder
      .addOutput({ to: issuer.tokenAddress, amount: issuerUtxo.satoshis + protocolFee, token: { category: shop.category, amount: issuerUtxo.token!.amount - stamps } })
      .addOutput({ to: p2pkh(shop.merchantPkh), amount: merchantGets })
      .addOutput({ to: opts.customerTokenAddress, amount: TOKEN_DUST, token: { category: shop.category, amount: stamps } });
    return change >= BCH_DUST ? builder.addOutput({ to: opts.customerAddress, amount: change }) : builder;
  };
  const { builder, fee } = withFee(assemble, total(coins) - pay - TOKEN_DUST, coins);
  return { builder, plan: { stamps, pay, merchantGets, protocolFee, fee, cost: pay + TOKEN_DUST + fee } };
}

export interface RedeemPlan {
  stamps: bigint;
  /** BCH the reserve releases. */
  reward: bigint;
  /** What lands in the customer's wallet: reward plus the stamp outputs' own sats, minus the fee. */
  payout: bigint;
  fee: bigint;
  stampChange: bigint;
}

/** Hand stamps to the reserve and take the BCH they are worth. The customer pays the network fee. */
export function buildRedeem(opts: {
  shop: Shop;
  reserveUtxo: SpendableUtxo;
  stampInputs: Coin[];
  stamps: bigint;
  customerAddress: string;
  customerTokenAddress: string;
  provider: NetworkProvider;
}): { builder: TransactionBuilder; plan: RedeemPlan } {
  const { shop, reserveUtxo, stampInputs, stamps } = opts;
  const held = stampInputs.reduce((sum, { utxo }) => sum + (utxo.token?.amount ?? 0n), 0n);
  if (stamps <= 0n) throw new Error('Redeem at least one stamp');
  if (stampInputs.some(({ utxo }) => !isStamps(utxo, shop))) throw new Error('Stamp inputs must hold only this shop\'s stamps');
  if (held < stamps) throw new Error(`Only ${held} stamps selected, ${stamps} needed`);

  const reserve = makeReserve(shop, opts.provider);
  const reward = stamps * shop.redeem;
  const reserveAfter = reserveUtxo.satoshis - reward;
  if (reserveAfter < TOKEN_DUST) throw new Error('The reward reserve cannot cover this redemption');
  const reserveStamps = isStamps(reserveUtxo, shop) ? reserveUtxo.token!.amount : 0n;
  const stampChange = held - stamps;
  const available = total(stampInputs) + reward - (stampChange > 0n ? TOKEN_DUST : 0n);

  const assemble = (fee: bigint) => {
    const payout = available - fee;
    if (payout < BCH_DUST) throw new Error('This redemption is too small to cover the network fee');
    const builder = new TransactionBuilder({ provider: opts.provider }).addInput(reserveUtxo, reserve.unlock.redeem());
    stampInputs.forEach(({ utxo, unlocker }) => builder.addInput(utxo, unlocker));
    builder.addOutput({ to: reserve.tokenAddress, amount: reserveAfter, token: { category: shop.category, amount: reserveStamps + stamps } });
    if (stampChange > 0n) builder.addOutput({ to: opts.customerTokenAddress, amount: TOKEN_DUST, token: { category: shop.category, amount: stampChange } });
    return builder.addOutput({ to: opts.customerAddress, amount: payout });
  };
  let sized;
  try {
    sized = withFee(assemble, available - BCH_DUST, stampInputs, true);
  } catch {
    throw new Error('This redemption is too small to cover the network fee');
  }
  return { builder: sized.builder, plan: { stamps, reward, payout: available - sized.fee, fee: sized.fee, stampChange } };
}

/** Forward an issuer output's accrued protocol fees to the protocol treasury. Anyone may send this. */
export function buildCollect(opts: { shop: Shop; protocol: Protocol; issuerUtxo: SpendableUtxo; provider: NetworkProvider }) {
  const issuer = makeIssuer(opts.shop, opts.protocol, opts.provider);
  const assemble = (fee: bigint) => new TransactionBuilder({ provider: opts.provider })
    .addInput(opts.issuerUtxo, issuer.unlock.collect())
    .addOutput({ to: issuer.tokenAddress, amount: TOKEN_DUST, token: opts.issuerUtxo.token })
    .addOutput({ to: p2pkh(opts.protocol.protocolPkh), amount: opts.issuerUtxo.satoshis - TOKEN_DUST - fee });
  return withFee(assemble, 900n, [], true);
}

export { shopPath, parseShopPath } from './links.js';
