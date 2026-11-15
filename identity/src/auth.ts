// Challenge-response sign-in. The app issues a random challenge; the user signs a NIP-42-style
// kind-22242 event with their Nostr key; the app checks it and then looks up the bound BCH addresses.
// No identity server is involved at any step.
import type { Event, EventTemplate } from 'nostr-tools';
import { checkSignature } from './binding';
import { binToHex } from '@bitauth/libauth';

export const AUTH_KIND = 22242;

export function createChallenge(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return binToHex(bytes);
}

/** The event a user signs to answer `challenge` for the app at `origin`. */
export const authEvent = (challenge: string, origin: string): EventTemplate => ({
  kind: AUTH_KIND,
  created_at: Math.floor(Date.now() / 1000),
  content: '',
  tags: [['relay', origin], ['challenge', challenge]],
});

export interface AuthResult { ok: boolean; pubkey?: string; reason?: string }

/** Check a signed answer: right kind, valid signature, this challenge, this app, and recent. */
export function verifyAuth(event: Event, challenge: string, origin: string, maxAgeSeconds = 600): AuthResult {
  if (event.kind !== AUTH_KIND) return { ok: false, reason: 'Wrong event kind' };
  if (!checkSignature(event)) return { ok: false, reason: 'Invalid signature' };
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  if (tag('challenge') !== challenge) return { ok: false, reason: 'Challenge does not match' };
  if (tag('relay') !== origin) return { ok: false, reason: 'Signed for a different app' };
  if (Math.abs(Date.now() / 1000 - event.created_at) > maxAgeSeconds) return { ok: false, reason: 'Answer is too old' };
  return { ok: true, pubkey: event.pubkey };
}
