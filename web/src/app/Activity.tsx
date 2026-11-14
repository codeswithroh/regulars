import { useMemo, useState } from 'react';
import { ArrowLeftRight, Wallet as WalletIcon } from 'lucide-react';
import { shopPath } from '@regulars/contracts';
import { explorerTx } from '../config';
import { Avatar, Empty, fmt } from '../components/kit';
import { useHistories, useKnownShops, useWallet, useWalletConnection } from '../ui';

type Filter = 'all' | 'earn' | 'redeem';

export function Activity() {
  const wc = useWalletConnection();
  const { pkhs, primary, manager } = useWallet();
  const { all } = useKnownShops(primary);
  const { events, loading } = useHistories(all.slice(0, 10));
  const [filter, setFilter] = useState<Filter>('all');
  const [newest, setNewest] = useState(true);
  const rows = useMemo(() => {
    const mine = (events ?? []).filter((e) => e.customer && pkhs.has(e.customer) && (e.kind === 'earn' || e.kind === 'redeem'));
    const filtered = filter === 'all' ? mine : mine.filter((e) => e.kind === filter);
    return newest ? filtered : [...filtered].reverse();
  }, [events, pkhs, filter, newest]);

  if (!manager) {
    return <div className="card"><Empty icon={<WalletIcon size={22} />}><span>Connect a wallet</span><button className="btn" onClick={() => wc.connect()}>Connect wallet</button></Empty></div>;
  }
  return (
    <div className="card fade-in">
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <div className="seg">
          {(['all', 'earn', 'redeem'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{{ all: 'All', earn: 'Earned', redeem: 'Redeemed' }[f]}</button>)}
        </div>
        <span className="spacer" />
        <div className="seg">
          <button className={newest ? 'on' : ''} onClick={() => setNewest(true)}>Newest</button>
          <button className={!newest ? 'on' : ''} onClick={() => setNewest(false)}>Oldest</button>
        </div>
      </div>
      {rows.length === 0
        ? <Empty icon={<ArrowLeftRight size={22} />}>{loading ? 'Loading…' : 'Nothing yet'}</Empty>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Shop</th><th>Status</th><th className="hide-sm">Date</th><th className="right">Stamps</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.txid + e.kind}>
                    <td><a className="cell-shop" href={`#${shopPath(e.shop)}`} style={{ textDecoration: 'none', color: 'inherit' }}><Avatar seed={e.shop.category} size={30} label={e.shop.name} />{e.shop.name}</a></td>
                    <td>
                      <a href={explorerTx(e.txid)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                        {e.kind === 'earn' ? <span className="pill accent">Earned</span> : <span className="pill good">Redeemed</span>}
                      </a>
                    </td>
                    <td className="hide-sm muted">{e.pending ? <span className="pill warn">Confirming</span> : new Date(e.time * 1000).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="right num">{e.kind === 'earn' ? '+' : '−'}{fmt(e.stamps)}</td>
                    <td className="right num" style={{ fontWeight: 600 }}>{e.kind === 'earn' ? '−' : '+'}{fmt(e.sats)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
