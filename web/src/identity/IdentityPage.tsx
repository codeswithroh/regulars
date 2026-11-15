import { useEffect, useState } from 'react';
import { BadgeCheck, Copy, KeyRound, Link2, Radio, Wallet as WalletIcon, Fingerprint, PenLine, Trash2 } from 'lucide-react';
import {
  verificationText, verifyMessage, parseAddress, identityEvent, currentClaims, publish, findByPubkey, fetchProfile,
  type BchClaim, type Identity, type Profile,
} from '@regulars/bch-nostr-id';
import { commitIdentity, commitmentCoin, fetchTx } from '../wallet';
import { Toast, shortAddr } from '../components/kit';
import { go, useAction, useWallet, useWalletConnection } from '../ui';
import { hasExtension, useNostrSigner } from './signer';
import { IdentityCard } from './IdentityCard';

const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined);

/** Create a Nostr identity, link BCH addresses to it with proofs, and publish the claims to relays. */
export function IdentityPage() {
  const wc = useWalletConnection();
  const { wallet, manager } = useWallet();
  const nostr = useNostrSigner();
  const signer = nostr.signer;
  const { notice, run, busy, clear } = useAction();
  const [claims, setClaims] = useState<BchClaim[]>([]);
  const [published, setPublished] = useState<Identity>();
  const [profile, setProfile] = useState<Profile | null>();
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'wallet' | 'message'>('wallet');
  const [msgAddress, setMsgAddress] = useState('');
  const [msgSig, setMsgSig] = useState('');
  const [nsec, setNsec] = useState('');
  const [showKey, setShowKey] = useState<string>();

  // What this key has already published, checked from the relays.
  useEffect(() => {
    setPublished(undefined); setProfile(undefined); setClaims([]);
    if (!signer) return;
    let live = true;
    findByPubkey(signer.pubkey, { fetchTx }).then((id) => { if (live) setPublished(id); }).catch(() => undefined);
    fetchProfile(signer.pubkey).then((p) => { if (live) setProfile(p ?? null); }).catch(() => live && setProfile(null));
    return () => { live = false; };
  }, [signer?.pubkey]);

  const text = signer ? verificationText(signer.pubkey) : '';
  const coin = wallet ? commitmentCoin(wallet) : undefined;
  let parsed: string | undefined;
  try { parsed = msgAddress.trim() ? parseAddress(msgAddress).address : undefined; } catch { parsed = undefined; }
  const sigOk = Boolean(parsed && msgSig.trim() && verifyMessage(parsed, text, msgSig.trim()));
  const addClaim = (claim: BchClaim) => setClaims((list) => [...list.filter((c) => c.address !== claim.address), claim]);

  const linkOnChain = () => run('Approve the link in your wallet…', async () => {
    const { txid, address } = await commitIdentity(manager!, wallet!, text);
    addClaim({ address: parseAddress(address).address, proof: { type: 'tx', txid } });
    return { kind: 'ok', text: `${shortAddr(address)} is committed on chain. Publish to finish.`, txid };
  });

  const publishAll = () => run('Publishing to Nostr relays…', async () => {
    const keep = await currentClaims(signer!.pubkey);
    if (!profile && name.trim()) await publish(await signer!.sign({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: name.trim() }) }));
    const event = await signer!.sign(identityEvent(claims, keep));
    const accepted = await publish(event);
    if (!accepted.length) throw new Error('No relay accepted the event. Check your connection and try again.');
    // Read it back from the relays like any other app would, and verify it from scratch.
    await new Promise((r) => setTimeout(r, 1200));
    const fresh = await findByPubkey(signer!.pubkey, { fetchTx });
    setPublished(fresh); setClaims([]);
    if (!profile && name.trim()) setProfile({ name: name.trim() });
    return { kind: 'ok', text: `Published to ${accepted.length} relays. ${fresh?.verified.length ?? 0} address${fresh?.verified.length === 1 ? '' : 'es'} verified.` };
  });

  return (
    <>
      <section className="pay fade-in" data-testid="identity-page">
        <div className="pay-main" style={{ display: 'grid', gap: 18 }}>
          <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 620 }}>
            Link your Bitcoin Cash wallet to a Nostr identity. Both keys sign, nothing is custodied, and any app can find and verify the link on public Nostr relays.
          </p>

          <div className={`fstep${signer ? ' done' : ' active'}`}>
            <span className="n">1</span>
            <div className="f-body">
              <h3>Your Nostr key</h3>
              {signer ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div className="code" data-testid="npub" style={{ wordBreak: 'break-all' }}>{signer.npub}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="pill neutral">{signer.kind === 'extension' ? 'Browser extension' : 'Key kept in this browser'}</span>
                    {profile?.name && <span className="pill good">{profile.display_name || profile.name}</span>}
                    <button className="btn ghost" onClick={() => copy(signer.npub)}><Copy size={15} />Copy npub</button>
                    {signer.kind === 'local' && <button className="btn ghost" onClick={() => setShowKey(showKey ? undefined : nostr.exportKey())}><KeyRound size={15} />{showKey ? 'Hide key' : 'Back up key'}</button>}
                    <button className="btn ghost" onClick={nostr.forget}><Trash2 size={15} />Use another key</button>
                  </div>
                  {showKey && <p className="notice error" style={{ animation: 'none', wordBreak: 'break-all' }}>Your secret key. Anyone with it controls this identity; store it somewhere safe. <b className="num">{showKey}</b></p>}
                  {profile === null && (
                    <label className="field">Display name (optional, published as your Nostr profile)<input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Corner Coffee" /></label>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {hasExtension() && <button className="btn" onClick={nostr.useExtension}><Fingerprint size={16} />Use my Nostr extension</button>}
                    <button className={`btn${hasExtension() ? ' ghost' : ''}`} data-testid="create-key" onClick={nostr.create}><KeyRound size={16} />Create a new key</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" value={nsec} onChange={(e) => setNsec(e.target.value)} placeholder="…or paste an nsec1 key to import it" aria-label="Import nsec" />
                    <button className="btn ghost" disabled={!nsec.trim()} onClick={() => nostr.importKey(nsec)}>Import</button>
                  </div>
                  {nostr.error && <p className="notice error" style={{ animation: 'none' }}>{nostr.error}</p>}
                </div>
              )}
            </div>
          </div>

          <div className={`fstep${claims.length || published?.verified.length ? ' done' : signer ? ' active' : ''}`}>
            <span className="n">2</span>
            <div className="f-body">
              <h3>Link a Bitcoin Cash address</h3>
              <div className="tabs" role="tablist" style={{ display: 'flex', gap: 6 }}>
                <button className={`amount${tab === 'wallet' ? ' on' : ''}`} onClick={() => setTab('wallet')}><WalletIcon size={15} />Connected wallet</button>
                <button className={`amount${tab === 'message' ? ' on' : ''}`} onClick={() => setTab('message')}><PenLine size={15} />Any wallet: sign a message</button>
              </div>
              {tab === 'wallet' ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                    Your wallet spends one of its own coins back to itself with your npub written into the transaction. That proves the address is yours. Only the network fee (about 300 sats) is spent.
                  </p>
                  {!manager ? (
                    <button className="btn accent" style={{ justifySelf: 'start' }} onClick={() => wc.connect()} disabled={wc.state === 'connecting'}><WalletIcon size={16} />Connect wallet</button>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn" data-testid="link-onchain" disabled={!signer || !coin || busy} onClick={linkOnChain}><Link2 size={16} />Link {coin ? shortAddr(coin.address) : 'address'}</button>
                      {wallet && !coin && <span className="muted" style={{ fontSize: 13 }}>Needs a coin of at least 1,500 sats.</span>}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>In Electron Cash, Paytaca or any wallet with "Sign message", sign this text with your address, then paste the signature.</p>
                  <div className="code" style={{ wordBreak: 'break-all', display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 1 }}>{text || 'Set up your Nostr key first'}</span>{text && <button className="icon-btn" aria-label="Copy message" onClick={() => copy(text)}><Copy size={15} /></button>}</div>
                  <input className="input" value={msgAddress} onChange={(e) => setMsgAddress(e.target.value)} placeholder="bitcoincash:q…" aria-label="Address that signed" />
                  <textarea className="input" rows={2} value={msgSig} onChange={(e) => setMsgSig(e.target.value)} placeholder="Signature (base64)" aria-label="Signature" />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button className="btn" disabled={!sigOk} onClick={() => { addClaim({ address: parsed!, proof: { type: 'msg', signature: msgSig.trim() } }); setMsgSig(''); setMsgAddress(''); }}>Add address</button>
                    {msgSig.trim() && <span className={`pill ${sigOk ? 'good' : 'bad'}`}>{sigOk ? 'Signature checks out' : 'Signature does not match'}</span>}
                  </div>
                </div>
              )}
              {claims.length > 0 && (
                <div className="summary" data-testid="pending-claims">
                  {claims.map((c) => <div className="sum-row" key={c.address}><span className="num">{shortAddr(c.address)}</span><b>{c.proof.type === 'tx' ? 'on-chain proof' : 'signed message'}</b></div>)}
                </div>
              )}
            </div>
          </div>

          <div className={`fstep${published?.verified.length ? ' done' : claims.length ? ' active' : ''}`}>
            <span className="n">3</span>
            <div className="f-body">
              <h3>Publish to Nostr</h3>
              <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Signs a NIP-39 identity event (kind 10011) with your Nostr key and sends it to public relays. Other claims you already published are kept.</p>
              <button className="btn lg" style={{ justifySelf: 'start' }} data-testid="publish" disabled={!signer || !claims.length || busy} onClick={publishAll}><Radio size={18} />Publish identity</button>
            </div>
          </div>
        </div>
        <aside className="pay-side">
          {published ? (
            <>
              <IdentityCard identity={published} />
              <button className="btn ghost" onClick={() => go(`/app/id/${published.npub}`)}><BadgeCheck size={16} />Open public profile</button>
            </>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>{signer ? 'Nothing published for this key yet.' : 'Your verified identity will show here.'}</p>
          )}
        </aside>
      </section>
      <Toast notice={notice} onClose={clear} />
    </>
  );
}
