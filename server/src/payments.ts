import { decodeTransaction, hexToBin, hash160, binToHex, encodeCashAddress, lockingBytecodeToCashAddress } from '@bitauth/libauth';

export interface Payment {
  txid: string;
  /** Sats this transaction paid to the merchant in plain (token-free) outputs. */
  paidSats: bigint;
  /** Token-aware address of the payer, where stamps are sent. */
  payerTokenAddress: string;
}

/** Read the public key out of a P2PKH unlocking script: <signature> <33-byte pubkey>. */
function p2pkhPubkey(unlocking: Uint8Array): Uint8Array | undefined {
  const sigLength = unlocking[0];
  if (sigLength === undefined || sigLength < 64 || sigLength > 75) return undefined;
  const pubStart = 1 + sigLength;
  if (unlocking[pubStart] !== 33 || unlocking.length !== pubStart + 34) return undefined;
  return unlocking.slice(pubStart + 1);
}

/**
 * Decide whether a transaction is a customer payment to the merchant and who should get stamps.
 * Returns undefined for the merchant's own transactions (change, stamp issuance) and for
 * payments whose first input is not a plain P2PKH spend, since there is no address to reward.
 */
export function readPayment(
  rawTxHex: string,
  txid: string,
  merchantPkh: Uint8Array,
  prefix: 'bitcoincash' | 'bchtest',
): Payment | undefined {
  const tx = decodeTransaction(hexToBin(rawTxHex));
  if (typeof tx === 'string') throw new Error(`Cannot decode ${txid}: ${tx}`);

  const payers = tx.inputs.map((input) => p2pkhPubkey(input.unlockingBytecode)).map((pub) => pub && hash160(pub));
  const merchantHex = binToHex(merchantPkh);
  if (payers.some((pkh) => pkh && binToHex(pkh) === merchantHex)) return undefined;
  const payer = payers[0];
  if (!payer) return undefined;

  const merchantAddress = encodeCashAddress({ prefix, type: 'p2pkh', payload: merchantPkh, throwErrors: true }).address;
  let paidSats = 0n;
  for (const output of tx.outputs) {
    if (output.token) continue;
    const to = lockingBytecodeToCashAddress({ bytecode: output.lockingBytecode, prefix });
    if (typeof to !== 'string' && to.address === merchantAddress) paidSats += output.valueSatoshis;
  }
  if (paidSats === 0n) return undefined;

  return {
    txid,
    paidSats,
    payerTokenAddress: encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload: payer, throwErrors: true }).address,
  };
}

export const stampsEarned = (paidSats: bigint, satsPerStampEarned: bigint) => paidSats / satsPerStampEarned;
