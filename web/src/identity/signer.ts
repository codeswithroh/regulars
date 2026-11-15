// The user's Nostr key: a NIP-07 browser extension (Alby, nos2x…) when present, otherwise a key kept in
// this browser that the user can back up or import. The site never sends a private key anywhere.
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event, type EventTemplate } from 'nostr-tools';
import { binToHex, hexToBin } from '@bitauth/libauth';
import { useCallback, useEffect, useState } from 'react';

export interface NostrSigner { kind: 'extension' | 'local'; pubkey: string; npub: string; sign: (t: EventTemplate) => Promise<Event> }

type Nip07 = { getPublicKey(): Promise<string>; signEvent(t: EventTemplate): Promise<Event> };
const extension = () => (window as unknown as { nostr?: Nip07 }).nostr;
export const hasExtension = () => Boolean(extension());

const KEY = 'regulars-nostr-key';
const MODE = 'regulars-nostr-mode';
const read = (k: string) => { try { return localStorage.getItem(k) ?? undefined; } catch { return undefined; } };
const write = (k: string, v?: string) => { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };

function localSigner(hex: string): NostrSigner {
  const sk = hexToBin(hex);
  const pubkey = getPublicKey(sk);
  return { kind: 'local', pubkey, npub: nip19.npubEncode(pubkey), sign: async (t) => finalizeEvent(t, sk) };
}

async function extensionSigner(): Promise<NostrSigner> {
  const ext = extension();
  if (!ext) throw new Error('No Nostr extension found in this browser');
  const pubkey = await ext.getPublicKey();
  return { kind: 'extension', pubkey, npub: nip19.npubEncode(pubkey), sign: (t) => ext.signEvent(t) };
}

/** The signer for this browser, plus ways to create, import, export and forget a key. */
export function useNostrSigner() {
  const [signer, setSigner] = useState<NostrSigner>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (read(MODE) === 'extension') extensionSigner().then(setSigner).catch(() => undefined);
    else { const hex = read(KEY); if (hex) setSigner(localSigner(hex)); }
  }, []);
  const useExtension = useCallback(async () => {
    try { setError(undefined); setSigner(await extensionSigner()); write(MODE, 'extension'); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  const create = useCallback(() => { const hex = binToHex(generateSecretKey()); write(KEY, hex); write(MODE, 'local'); setSigner(localSigner(hex)); }, []);
  const importKey = useCallback((nsec: string) => {
    try {
      const decoded = nip19.decode(nsec.trim());
      if (decoded.type !== 'nsec') throw new Error('Paste a key that starts with nsec1');
      const hex = binToHex(decoded.data);
      write(KEY, hex); write(MODE, 'local'); setSigner(localSigner(hex)); setError(undefined);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  const exportKey = useCallback(() => { const hex = read(KEY); return hex ? nip19.nsecEncode(hexToBin(hex)) : undefined; }, []);
  const forget = useCallback(() => { write(KEY); write(MODE); setSigner(undefined); }, []);
  return { signer, error, useExtension, create, importKey, exportKey, forget };
}
