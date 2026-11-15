import { useMemo, useState } from 'react';
import { Coffee, Fingerprint, KeyRound, LogIn, RefreshCw } from 'lucide-react';
import { authEvent, createChallenge, findByPubkey, verifyAuth, type Identity } from '@regulars/bch-nostr-id';
import '../styles/app.css';
import { fetchTx } from '../wallet';
import { hasExtension, useNostrSigner } from './signer';
import { IdentityCard } from './IdentityCard';

/**
 * A stand-in for an independent app ("Corner Coffee members"). It knows nothing about Regulars accounts:
 * it issues a challenge, checks the signed answer, and reads the user's BCH binding from Nostr relays.
 */
export function SignInDemo() {
  const nostr = useNostrSigner();
  const [challenge, setChallenge] = useState(createChallenge);
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [member, setMember] = useState<{ identity?: Identity; pubkey: string }>();
  const origin = useMemo(() => window.location.origin, []);

  const signIn = async () => {
    setError(undefined); setMember(undefined);
    try {
      const signer = nostr.signer!;
      setStep('Signing the challenge with your Nostr key…');
      const answer = await signer.sign(authEvent(challenge, origin));
      setStep('Checking the signature…');
      const check = verifyAuth(answer, challenge, origin);
      if (!check.ok) throw new Error(check.reason);
      setStep('Looking up your linked Bitcoin Cash addresses on Nostr relays…');
      const identity = await findByPubkey(check.pubkey!, { fetchTx });
      setMember({ identity, pubkey: check.pubkey! });
      setChallenge(createChallenge()); // a challenge is good for one sign-in
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStep(undefined); }
  };

  const verified = member?.identity?.verified.length ?? 0;
  return (
    <div className="app" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: '#f6efe6' }}>
      <main className="card" data-testid="signin-demo" style={{ width: 'min(560px, 100%)', display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: '#2a1810', color: '#fff8ef', display: 'grid', placeItems: 'center' }}><Coffee size={20} /></span>
          <div><b style={{ fontSize: 18 }}>Corner Coffee members</b><span className="muted" style={{ display: 'block', fontSize: 12.5 }}>Demo app · signs you in with Nostr + Bitcoin Cash</span></div>
        </div>
        {!member && (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              No password and no account here. We send a one-time challenge, your Nostr key signs it, and we read your linked BCH wallet from public relays to see if you're a regular.
            </p>
            <div className="summary">
              <div className="sum-row"><span>Challenge</span><b className="num" data-testid="challenge" style={{ fontSize: 12 }}>{challenge}</b></div>
              <div className="sum-row"><span>App</span><b className="num" style={{ fontSize: 12 }}>{origin}</b></div>
            </div>
            {nostr.signer ? (
              <button className="btn lg" data-testid="signin" disabled={Boolean(step)} onClick={signIn}><LogIn size={18} />Sign in as {nostr.signer.npub.slice(0, 12)}…</button>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {hasExtension() && <button className="btn lg" onClick={nostr.useExtension}><Fingerprint size={18} />Use my Nostr extension</button>}
                <a className="btn lg ghost" href="#/app/identity"><KeyRound size={18} />Set up an identity first</a>
              </div>
            )}
          </>
        )}
        {step && <p className="notice busy" style={{ animation: 'none' }}>{step}</p>}
        {error && <p className="notice error" style={{ animation: 'none' }}>{error}</p>}
        {member && (
          <>
            <h2 style={{ margin: 0, fontSize: 22 }} data-testid="welcome">
              {verified ? `Welcome back${member.identity?.profile?.name ? `, ${member.identity.profile.name}` : ''}.` : 'Signed in, but no Bitcoin Cash wallet is linked yet.'}
            </h2>
            {member.identity ? <IdentityCard identity={member.identity} /> : <p className="muted" style={{ margin: 0 }}>This key has not published an identity. <a href="#/app/identity">Link a wallet</a></p>}
            <button className="btn ghost" onClick={() => setMember(undefined)}><RefreshCw size={16} />Sign out</button>
          </>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          This page only uses the open <code>@regulars/bch-nostr-id</code> library, public Nostr relays and the BCH chain. <a href="#/app/identity">Back to Regulars</a>
        </p>
      </main>
    </div>
  );
}
