// Finding identities on public Nostr relays: by Nostr key, by NIP-05 name, or in reverse by BCH address.
import { SimplePool, nip05, nip19, type Event, type Filter } from 'nostr-tools';
import { parseAddress } from './bch';
import { IDENTITY_KIND, PLATFORM, verifyIdentity, type Verification, type VerifyOptions } from './binding';

export const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io', 'wss://relay.snort.social', 'wss://offchain.pub', 'wss://relay.nostr.net'];

export interface Profile { name?: string; display_name?: string; picture?: string; about?: string; nip05?: string }
export interface Identity extends Verification { event: Event; profile?: Profile }

let shared: SimplePool | undefined;
const pool = () => (shared ??= new SimplePool());

/** Hex pubkey from an npub, nprofile, hex key, or NIP-05 name (`alice@example.com`). */
export async function resolvePubkey(input: string): Promise<string> {
  const value = input.trim().replace(/^nostr:/, '');
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (value.startsWith('npub1') || value.startsWith('nprofile1')) {
    const decoded = nip19.decode(value);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  }
  if (value.includes('@') || value.includes('.')) {
    const pointer = await nip05.queryProfile(value);
    if (pointer) return pointer.pubkey;
  }
  throw new Error(`Not a Nostr key or NIP-05 name: ${input}`);
}

async function query(filter: Filter, relays: string[]): Promise<Event[]> {
  return pool().querySync(relays, filter, { maxWait: 4000 });
}

/** Newest event per author (replaceable events can come back from several relays at different versions). */
const newestPerAuthor = (events: Event[]) => {
  const best = new Map<string, Event>();
  for (const e of events) { const b = best.get(e.pubkey); if (!b || e.created_at > b.created_at) best.set(e.pubkey, e); }
  return [...best.values()];
};

export async function fetchProfile(pubkey: string, relays = DEFAULT_RELAYS): Promise<Profile | undefined> {
  const [latest] = newestPerAuthor(await query({ kinds: [0], authors: [pubkey] }, relays));
  try { return latest ? JSON.parse(latest.content) : undefined; } catch { return undefined; }
}

/** The current identity event of a Nostr key, verified. */
export async function findByPubkey(input: string, options: VerifyOptions & { relays?: string[] } = {}): Promise<Identity | undefined> {
  const relays = options.relays ?? DEFAULT_RELAYS;
  const pubkey = await resolvePubkey(input);
  const [event] = newestPerAuthor(await query({ kinds: [IDENTITY_KIND], authors: [pubkey] }, relays));
  if (!event) return undefined;
  const [verification, profile] = await Promise.all([verifyIdentity(event, options), fetchProfile(pubkey, relays)]);
  return { ...verification, event, profile };
}

/**
 * Reverse lookup: Nostr identities that claim this BCH address, verified. Anyone can *claim* an
 * address, so only identities whose proof passes are returned.
 */
export async function findByAddress(address: string, options: VerifyOptions & { relays?: string[] } = {}): Promise<Identity[]> {
  const relays = options.relays ?? DEFAULT_RELAYS;
  const canonical = parseAddress(address).address;
  const events = newestPerAuthor(await query({ kinds: [IDENTITY_KIND], '#i': [`${PLATFORM}:${canonical}`] }, relays));
  const found: Identity[] = [];
  for (const event of events) {
    const verification = await verifyIdentity(event, options);
    if (verification.verified.includes(canonical)) found.push({ ...verification, event, profile: await fetchProfile(event.pubkey, relays) });
  }
  return found;
}

/** Publish a signed event to relays; resolves with the relays that accepted it. */
export async function publish(event: Event, relays = DEFAULT_RELAYS): Promise<string[]> {
  const results = await Promise.allSettled(pool().publish(relays, event));
  return relays.filter((_, i) => results[i].status === 'fulfilled');
}

/** The user's current `i` tags, so a new list can keep their other claims. */
export async function currentClaims(pubkey: string, relays = DEFAULT_RELAYS): Promise<string[][]> {
  const [event] = newestPerAuthor(await query({ kinds: [IDENTITY_KIND], authors: [pubkey] }, relays));
  return event ? event.tags.filter((t) => t[0] === 'i') : [];
}
