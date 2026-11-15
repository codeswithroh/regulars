// The binding itself: a NIP-39 identity-claims event (kind 10011) whose `i` tags name BCH addresses,
// each with a BCH-side proof that commits to the Nostr key. Both keys sign; neither is reused.
import { verifyEvent, nip19, type Event, type EventTemplate } from 'nostr-tools';

/**
 * nostr-tools caches a passed check on the event object, and a spread copy carries that flag along.
 * Checking a fresh copy of just the signed fields means a modified event is always re-checked.
 */
export const checkSignature = (e: Event) =>
  verifyEvent({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig } as Event);
import { parseAddress, verifyMessage, verifyCommitment, type FetchTransaction } from './bch';

/** NIP-39 identity claims list (replaceable). */
export const IDENTITY_KIND = 10011;
/** NIP-39 platform name for Bitcoin Cash P2PKH addresses. */
export const PLATFORM = 'bch';

/** The NIP-39 verification text. The BCH key signs (or commits to) exactly this. */
export const verificationText = (pubkey: string) => `Verifying that I control the following Nostr public key: ${nip19.npubEncode(pubkey)}`;

export type BchProof =
  | { type: 'msg'; signature: string }
  | { type: 'tx'; txid: string };

export interface BchClaim { address: string; proof: BchProof }

export const encodeProof = (proof: BchProof) => (proof.type === 'msg' ? `msg:${proof.signature}` : `tx:${proof.txid}`);
export function decodeProof(value: string): BchProof | undefined {
  if (value.startsWith('msg:')) return { type: 'msg', signature: value.slice(4) };
  if (value.startsWith('tx:')) return { type: 'tx', txid: value.slice(3) };
  return undefined;
}

export const identityTag = (claim: BchClaim) => ['i', `${PLATFORM}:${parseAddress(claim.address).address}`, encodeProof(claim.proof)];

/**
 * An unsigned kind-10011 event carrying these BCH claims. The list is replaceable, so `keep` carries
 * over the other `i` tags (GitHub, X, other addresses…) from the user's current list.
 */
export function identityEvent(claims: BchClaim[], keep: string[][] = []): EventTemplate {
  const mine = new Set(claims.map((c) => `${PLATFORM}:${parseAddress(c.address).address}`));
  const others = keep.filter((t) => t[0] === 'i' && !mine.has(t[1]));
  return { kind: IDENTITY_KIND, created_at: Math.floor(Date.now() / 1000), content: '', tags: [...others, ...claims.map(identityTag)] };
}

/** BCH claims listed in an event, unverified. */
export function claimsOf(event: Event): BchClaim[] {
  return event.tags.flatMap((t) => {
    if (t[0] !== 'i' || !t[1]?.startsWith(`${PLATFORM}:`) || !t[2]) return [];
    const proof = decodeProof(t[2]);
    try {
      return proof ? [{ address: parseAddress(t[1].slice(PLATFORM.length + 1)).address, proof }] : [];
    } catch { return []; }
  });
}

export interface VerifiedClaim extends BchClaim { ok: boolean; reason?: string }
export interface Verification {
  /** The Nostr key whose signature covers the event. */
  pubkey: string;
  npub: string;
  /** Whether the event signature itself is valid. */
  signed: boolean;
  claims: VerifiedClaim[];
  /** Addresses whose binding passed every check. */
  verified: string[];
}

export interface VerifyOptions {
  /** Needed for `tx:` proofs. Any Electrum server or explorer that returns raw transaction hex works. */
  fetchTx?: FetchTransaction;
}

/**
 * Check an identity event end to end:
 * 1. the Nostr signature covers the event, so the Nostr key claims each address;
 * 2. each address's proof commits to that same Nostr key, so the BCH key claims it back.
 * A proof copied into someone else's event fails step 2, because it names a different npub.
 */
export async function verifyIdentity(event: Event, options: VerifyOptions = {}): Promise<Verification> {
  const signed = event.kind === IDENTITY_KIND && checkSignature(event);
  const text = verificationText(event.pubkey);
  const claims: VerifiedClaim[] = [];
  for (const claim of claimsOf(event)) {
    if (!signed) { claims.push({ ...claim, ok: false, reason: 'Event signature is invalid' }); continue; }
    if (claim.proof.type === 'msg') {
      const ok = verifyMessage(claim.address, text, claim.proof.signature);
      claims.push({ ...claim, ok, reason: ok ? undefined : 'Signature does not match this address and npub' });
    } else if (!options.fetchTx) {
      claims.push({ ...claim, ok: false, reason: 'No way to fetch the commitment transaction' });
    } else {
      const check = await verifyCommitment(claim.proof.txid, claim.address, text, options.fetchTx);
      claims.push({ ...claim, ok: check.ok, reason: check.reason });
    }
  }
  return { pubkey: event.pubkey, npub: nip19.npubEncode(event.pubkey), signed, claims, verified: claims.filter((c) => c.ok).map((c) => c.address) };
}
