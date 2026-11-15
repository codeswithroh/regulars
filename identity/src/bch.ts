// Bitcoin Cash side of the binding: addresses, signed messages, and on-chain commitments.
import {
  secp256k1, hash160, hash256, utf8ToBin, binToHex, hexToBin, binToBase64, base64ToBin, bigIntToCompactUint, flattenBinArray,
  decodeCashAddress, encodeCashAddress, decodeTransaction, encodeTransaction, decodeAuthenticationInstructions, binToUtf8,
  createVirtualMachineBch, type Transaction, type Output,
} from '@bitauth/libauth';

export type BchNetwork = 'mainnet' | 'chipnet';
const PREFIX: Record<BchNetwork, 'bitcoincash' | 'bchtest'> = { mainnet: 'bitcoincash', chipnet: 'bchtest' };

export interface ParsedAddress { address: string; pkh: string; network: BchNetwork }

/**
 * Parse a P2PKH cash address (with or without its prefix, token-aware or not) into its canonical form:
 * lowercase, prefixed, non-token. Two spellings of the same key hash compare equal after this.
 */
export function parseAddress(input: string): ParsedAddress {
  const raw = input.trim().toLowerCase();
  const tries = raw.includes(':') ? [raw] : [`bitcoincash:${raw}`, `bchtest:${raw}`];
  for (const candidate of tries) {
    const decoded = decodeCashAddress(candidate);
    if (typeof decoded === 'string') continue;
    if (decoded.type !== 'p2pkh' && decoded.type !== 'p2pkhWithTokens') throw new Error('Only P2PKH addresses can be bound to an identity');
    const network: BchNetwork = decoded.prefix === 'bitcoincash' ? 'mainnet' : 'chipnet';
    return { address: addressOfPkh(decoded.payload, network), pkh: binToHex(decoded.payload), network };
  }
  throw new Error(`Not a Bitcoin Cash address: ${input}`);
}

export const addressOfPkh = (pkh: Uint8Array | string, network: BchNetwork) =>
  encodeCashAddress({ prefix: PREFIX[network], type: 'p2pkh', payload: typeof pkh === 'string' ? hexToBin(pkh) : pkh, throwErrors: true }).address;

export const addressOfPublicKey = (publicKey: Uint8Array, network: BchNetwork) => addressOfPkh(hash160(publicKey), network);

// ---- Signed messages (the "Bitcoin Signed Message" format used by Electron Cash, Paytaca and most BCH wallets).

const MAGIC = utf8ToBin('Bitcoin Signed Message:\n');
const lengthPrefixed = (bytes: Uint8Array) => flattenBinArray([bigIntToCompactUint(BigInt(bytes.length)), bytes]);

/** The 32-byte hash a wallet signs for `message`. */
export const messageHash = (message: string) => hash256(flattenBinArray([lengthPrefixed(MAGIC), lengthPrefixed(utf8ToBin(message))]));

/** Sign `message` with a private key, returning the usual base64 compact signature (compressed key). */
export function signMessage(privateKey: Uint8Array, message: string): string {
  const signed = secp256k1.signMessageHashRecoverableCompact(privateKey, messageHash(message));
  if (typeof signed === 'string') throw new Error(signed);
  return binToBase64(flattenBinArray([Uint8Array.of(27 + 4 + signed.recoveryId), signed.signature]));
}

/** Check that `signature` (base64, 65 bytes) over `message` was made by the key behind `address`. */
export function verifyMessage(address: string, message: string, signature: string): boolean {
  let bytes: Uint8Array;
  try { bytes = base64ToBin(signature.trim()); } catch { return false; }
  if (bytes.length !== 65) return false;
  const header = bytes[0];
  if (header < 27 || header > 34) return false;
  const recoveryId = ((header - 27) & 3) as 0 | 1 | 2 | 3;
  const compressed = header >= 31;
  const hash = messageHash(message);
  const recovered = compressed
    ? secp256k1.recoverPublicKeyCompressed(bytes.slice(1), recoveryId, hash)
    : secp256k1.recoverPublicKeyUncompressed(bytes.slice(1), recoveryId, hash);
  if (typeof recovered === 'string') return false;
  const { pkh } = parseAddress(address);
  return binToHex(hash160(recovered)) === pkh;
}

// ---- On-chain commitments (for wallets that sign transactions but not messages, such as WizardConnect wallets).

/** An OP_RETURN locking script carrying `text` as one push. */
export function commitmentScript(text: string): Uint8Array {
  const data = utf8ToBin(text);
  if (data.length > 220) throw new Error('Commitment text is too long for an OP_RETURN output');
  const push = data.length < 76 ? Uint8Array.of(data.length) : Uint8Array.of(0x4c, data.length);
  return flattenBinArray([Uint8Array.of(0x6a), push, data]);
}

/** Texts carried by the OP_RETURN outputs of a transaction. */
export function opReturnTexts(tx: Transaction): string[] {
  const texts: string[] = [];
  for (const output of tx.outputs) {
    if (output.lockingBytecode[0] !== 0x6a) continue;
    const instructions = decodeAuthenticationInstructions(output.lockingBytecode.slice(1));
    for (const ins of instructions) if ('data' in ins && ins.data.length) texts.push(binToUtf8(ins.data));
  }
  return texts;
}

/** Key hashes (hex) of the P2PKH inputs of a transaction, read from their unlocking scripts. */
export function p2pkhInputPkhs(tx: Transaction): string[] {
  return tx.inputs.flatMap((input) => {
    const ins = decodeAuthenticationInstructions(input.unlockingBytecode);
    const last = ins[ins.length - 1];
    if (ins.length !== 2 || !last || !('data' in last) || last.data.length !== 33) return [];
    return [binToHex(hash160(last.data))];
  });
}

/** What `verifyCommitment` needs from the network: raw transactions by id. */
export type FetchTransaction = (txid: string) => Promise<string>;

export interface CommitmentCheck { ok: boolean; reason?: string }

/**
 * A commitment proves control of `address` when a transaction on chain is spent from that address
 * (so its key signed it) and carries `text` in an OP_RETURN output. The transaction is fetched by id,
 * so it must exist on the network; any Electrum server or block explorer can serve it.
 */
export async function verifyCommitment(txid: string, address: string, text: string, fetchTx: FetchTransaction): Promise<CommitmentCheck> {
  if (!/^[0-9a-f]{64}$/i.test(txid)) return { ok: false, reason: 'Malformed transaction id' };
  let tx: Transaction;
  try {
    const hex = await fetchTx(txid.toLowerCase());
    const decoded = decodeTransaction(hexToBin(hex));
    if (typeof decoded === 'string') return { ok: false, reason: decoded };
    tx = decoded;
  } catch (error) {
    return { ok: false, reason: `Transaction not found: ${error instanceof Error ? error.message : error}` };
  }
  // A server could hand back any bytes; make sure they are the transaction that was asked for.
  if (txidOf(tx) !== txid.toLowerCase()) return { ok: false, reason: 'Server returned a different transaction' };
  if (!opReturnTexts(tx).includes(text)) return { ok: false, reason: 'Transaction does not carry the verification text' };
  const { pkh } = parseAddress(address);
  if (!p2pkhInputPkhs(tx).includes(pkh)) return { ok: false, reason: 'Transaction is not spent from that address' };
  // Re-check every signature against the coins it spends, so a server cannot vouch for a forged transaction.
  try {
    const sourceOutputs: Output[] = [];
    for (const input of tx.inputs) {
      const prevId = binToHex(input.outpointTransactionHash);
      const prev = decodeTransaction(hexToBin(await fetchTx(prevId)));
      if (typeof prev === 'string' || txidOf(prev) !== prevId) return { ok: false, reason: 'Could not load the coins this transaction spends' };
      sourceOutputs.push(prev.outputs[input.outpointIndex]);
    }
    const result = vm().verify({ transaction: tx, sourceOutputs });
    if (result !== true) return { ok: false, reason: `Invalid transaction: ${result}` };
  } catch (error) {
    return { ok: false, reason: `Could not check signatures: ${error instanceof Error ? error.message : error}` };
  }
  return { ok: true };
}

let machine: ReturnType<typeof createVirtualMachineBch> | undefined;
const vm = () => (machine ??= createVirtualMachineBch());

/** Transaction id (display order hex) of a decoded transaction. */
export const txidOf = (tx: Transaction) => binToHex(hash256(encodeTransaction(tx)).reverse());
