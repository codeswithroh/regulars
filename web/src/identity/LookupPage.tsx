import { useEffect, useState } from 'react';
import { Search, Send } from 'lucide-react';
import { findByAddress, findByPubkey, parseAddress, type Identity } from '@regulars/bch-nostr-id';
import { fetchTx, sendBch } from '../wallet';
import { Toast, Empty, shortAddr } from '../components/kit';
import { go, useAction, useWallet, useWalletConnection } from '../ui';
import { IdentityCard } from './IdentityCard';

const isAddress = (q: string) => { try { parseAddress(q); return true; } catch { return false; } };

/** Look up anyone by npub, NIP-05 name or BCH address, verify their binding, and pay them. */
export function LookupPage({ query }: { query?: string }) {
  const [input, setInput] = useState(query ?? '');
  const [results, setResults] = useState<Identity[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setInput(query ?? ''); setResults(undefined); setError(undefined);
    if (!query) return;
    let live = true;
    setLoading(true);
    (isAddress(query) ? findByAddress(query, { fetchTx }) : findByPubkey(query, { fetchTx }).then((id) => (id ? [id] : [])))
      .then((r) => { if (live) setResults(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [query]);

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18, maxWidth: 760 }} data-testid="lookup-page">
      <form className="card" style={{ display: 'flex', gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (input.trim()) go(`/app/id/${encodeURIComponent(input.trim())}`); }}>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="npub1…, name@domain or bitcoincash:q…" aria-label="Identity to look up" />
        <button className="btn"><Search size={16} />Verify</button>
      </form>
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
        Everything here is read from public Nostr relays and the Bitcoin Cash chain, and checked in your browser. No Regulars server is involved.
      </p>
      {loading && <div className="card skel" style={{ height: 160 }} />}
      {error && <p className="notice error" style={{ animation: 'none' }}>{error}</p>}
      {results && results.length === 0 && (
        <div className="card"><Empty icon={<Search size={22} />}><span>No verified identity found for {query && isAddress(query) ? 'this address' : 'this key'}.</span></Empty></div>
      )}
      {results?.map((id) => (
        <div key={id.pubkey} style={{ display: 'grid', gap: 12 }}>
          <IdentityCard identity={id} />
          {id.verified[0] && <PayIdentity identity={id} />}
        </div>
      ))}
    </section>
  );
}

function PayIdentity({ identity }: { identity: Identity }) {
  const wc = useWalletConnection();
  const { wallet, manager, refresh } = useWallet();
  const { notice, run, busy, clear } = useAction(refresh);
  const [amount, setAmount] = useState('10000');
  const to = identity.verified[0];
  const sats = /^\d{3,12}$/.test(amount) ? BigInt(amount) : 0n;
  const name = identity.profile?.display_name || identity.profile?.name || shortAddr(identity.npub);
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <b>Pay {name}</b>
      <span className="muted" style={{ fontSize: 13 }}>To their verified address {shortAddr(to)}. No address to copy or check by hand.</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <input className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} aria-label="Amount in sats" />
        {manager
          ? <button className="btn" disabled={!wallet || busy || sats < 546n} onClick={() => run('Approve the payment in your wallet…', async () => ({ kind: 'ok', text: `Sent ${sats} sats to ${name}.`, txid: await sendBch(manager, wallet!, to, sats, `Send ${sats} sats to ${name} (verified Nostr identity)`) }))}><Send size={16} />Send sats</button>
          : <button className="btn accent" onClick={() => wc.connect()}>Connect wallet</button>}
      </div>
      <Toast notice={notice} onClose={clear} />
    </div>
  );
}
