import { useEffect, useState } from 'react';
import { BadgeCheck, CircleX, ExternalLink } from 'lucide-react';
import type { Identity } from '@regulars/bch-nostr-id';
import { Avatar, shortAddr, fmt } from '../components/kit';
import { explorerTx } from '../config';
import { tokensAt } from '../wallet';
import { useKnownShops } from '../ui';

/** One identity: who it is, every BCH claim with its check, and the loyalty stamps it holds. */
export function IdentityCard({ identity }: { identity: Identity }) {
  const name = identity.profile?.display_name || identity.profile?.name;
  const { all } = useKnownShops();
  const [stamps, setStamps] = useState<{ shop: string; amount: bigint }[]>();
  const key = identity.verified.join(',');
  useEffect(() => {
    let live = true;
    Promise.all(identity.verified.map(tokensAt)).then((maps) => {
      const rows = all.flatMap((shop) => {
        const amount = maps.reduce((sum, m) => sum + (m.get(shop.category) ?? 0n), 0n);
        return amount > 0n ? [{ shop: shop.name, amount }] : [];
      });
      if (live) setStamps(rows);
    }).catch(() => live && setStamps([]));
    return () => { live = false; };
  }, [key, all.length]);

  return (
    <div className="card" data-testid="identity-card" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {identity.profile?.picture
          ? <img src={identity.profile.picture} alt="" width={44} height={44} style={{ borderRadius: 14, objectFit: 'cover' }} />
          : <Avatar seed={identity.pubkey} size={44} label={name ?? 'N'} />}
        <div style={{ minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 17 }}>{name ?? 'Unnamed'}</b>
          <span className="muted num" style={{ fontSize: 12.5 }}>{identity.npub.slice(0, 16)}…{identity.npub.slice(-6)}</span>
          {identity.profile?.nip05 && <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{identity.profile.nip05}</span>}
        </div>
      </div>
      <div className="summary">
        <div className="sum-row"><span>Nostr signature</span>{identity.signed ? <span className="pill good"><BadgeCheck size={13} />valid</span> : <span className="pill bad"><CircleX size={13} />invalid</span>}</div>
        {identity.claims.map((c) => (
          <div className="sum-row" key={c.address} data-testid="claim" data-ok={c.ok}>
            <span className="num" title={c.address}>{shortAddr(c.address)}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {c.proof.type === 'tx' && <a href={explorerTx(c.proof.txid)} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 12 }}>on-chain<ExternalLink size={11} /></a>}
              {c.proof.type === 'msg' && <span className="muted" style={{ fontSize: 12 }}>signed message</span>}
              {c.ok ? <span className="pill good"><BadgeCheck size={13} />verified</span> : <span className="pill bad" title={c.reason}><CircleX size={13} />{c.reason ?? 'failed'}</span>}
            </span>
          </div>
        ))}
        {identity.claims.length === 0 && <div className="sum-row"><span>No BCH addresses claimed</span></div>}
      </div>
      {stamps && stamps.length > 0 && (
        <div>
          <div className="side-label" style={{ padding: 0, marginBottom: 6 }}>Regular at</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {stamps.map((s) => <span key={s.shop} className="pill accent">{s.shop} · {fmt(s.amount)} stamps</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
