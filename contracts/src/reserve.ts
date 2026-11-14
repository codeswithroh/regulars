import { Contract, TransactionBuilder, type NetworkProvider, type SpendableUtxo, type Unlocker } from 'cashscript';
import { binToHex, hexToBin } from '@bitauth/libauth';
import artifact from '../artifacts/RewardReserve.artifact.js';

export { artifact };

export interface ReserveParams {
  /** Stamp token category as wallets and explorers show it (hex). */
  stampCategory: string;
  /** Satoshis paid out per stamp handed in. */
  satsPerStamp: bigint;
  /** hash160 of the merchant's public key (hex). */
  merchantPkh: string;
}

/** Smallest output the network relays; token outputs need a little more than plain ones. */
export const TOKEN_DUST = 1000n;
export const BCH_DUST = 546n;
/** Bytes a wallet adds when it signs a P2PKH input: push + 65-byte signature + push + 33-byte key, with slack for ECDSA. */
export const PLACEHOLDER_INPUT_BYTES = 110n;

export function makeReserve(params: ReserveParams, provider: NetworkProvider) {
  // Script introspection sees the category in the opposite byte order from wallets.
  const categoryUnreversed = binToHex(hexToBin(params.stampCategory).reverse());
  return new Contract(artifact, [categoryUnreversed, params.satsPerStamp, params.merchantPkh], { provider });
}

export interface RedeemPlan {
  stamps: bigint;
  payout: bigint;
  fee: bigint;
  /** Stamps handed back to the customer because the selected UTXOs held more than `stamps`. */
  stampChange: bigint;
}

/**
 * Build a redemption: `stamps` go into the reserve, `stamps * satsPerStamp` comes out to the
 * customer. The network fee is taken from the customer's side, never from the reserve.
 */
export function buildRedeem(opts: {
  reserve: Contract<typeof artifact>;
  params: ReserveParams;
  reserveUtxo: SpendableUtxo;
  /** Customer UTXOs holding stamps, each with the unlocker that will sign it. */
  stampInputs: { utxo: SpendableUtxo; unlocker: Unlocker }[];
  stamps: bigint;
  /** Token-aware address that receives stamp change. */
  customerTokenAddress: string;
  /** Address that receives the BCH payout. */
  customerAddress: string;
  provider: NetworkProvider;
  feePerByte?: bigint;
}): { builder: TransactionBuilder; plan: RedeemPlan } {
  const { reserve, params, reserveUtxo, stampInputs, stamps, provider } = opts;
  const feePerByte = opts.feePerByte ?? 1n;

  const held = stampInputs.reduce((sum, { utxo }) => sum + (utxo.token?.amount ?? 0n), 0n);
  if (stamps <= 0n) throw new Error('Redeem at least one stamp');
  if (held < stamps) throw new Error(`Only ${held} stamps selected, ${stamps} needed`);
  if (stampInputs.some(({ utxo }) => utxo.token?.category !== params.stampCategory || utxo.token?.nft)) {
    throw new Error('Stamp inputs must hold only this merchant\'s fungible stamps');
  }

  const reward = stamps * params.satsPerStamp;
  const reserveAfter = reserveUtxo.satoshis - reward;
  if (reserveAfter < TOKEN_DUST) throw new Error('Reserve cannot cover this redemption');

  const reserveStampsBefore = reserveUtxo.token?.category === params.stampCategory ? reserveUtxo.token.amount : 0n;
  const stampChange = held - stamps;
  const customerSatsIn = stampInputs.reduce((sum, { utxo }) => sum + utxo.satoshis, 0n);

  const assemble = (fee: bigint) => {
    const builder = new TransactionBuilder({ provider });
    builder.addInput(reserveUtxo, reserve.unlock.redeem());
    for (const { utxo, unlocker } of stampInputs) builder.addInput(utxo, unlocker);

    builder.addOutput({
      to: reserve.tokenAddress,
      amount: reserveAfter,
      token: { category: params.stampCategory, amount: reserveStampsBefore + stamps },
    });
    let payout = customerSatsIn + reward - fee;
    if (stampChange > 0n) {
      builder.addOutput({
        to: opts.customerTokenAddress,
        amount: TOKEN_DUST,
        token: { category: params.stampCategory, amount: stampChange },
      });
      payout -= TOKEN_DUST;
    }
    if (payout < BCH_DUST) throw new Error('Redemption too small to cover the network fee');
    builder.addOutput({ to: opts.customerAddress, amount: payout });
    return { builder, payout };
  };

  // Size the transaction with a throwaway fee (payout pinned at dust), then rebuild with the real fee.
  const spare = customerSatsIn + reward - BCH_DUST - (stampChange > 0n ? TOKEN_DUST : 0n);
  let size: bigint;
  try {
    size = BigInt(assemble(spare).builder.build().length / 2);
  } catch {
    throw new Error('Redemption too small to cover the network fee');
  }
  // Wallet-signed inputs are sized empty until the wallet fills them in; allow for signature + key.
  const unsigned = BigInt(stampInputs.filter(({ unlocker }) => 'placeholder' in unlocker).length);
  const fee = (size + unsigned * PLACEHOLDER_INPUT_BYTES) * feePerByte + 10n;
  const { builder, payout } = assemble(fee);
  return { builder, plan: { stamps, payout, fee, stampChange } };
}
