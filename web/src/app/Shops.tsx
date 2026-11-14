import { useState } from 'react';
import { ArrowUpRight, Link2, Store } from 'lucide-react';
import { parseShopPath, shopPath, type Shop } from '@regulars/contracts';
import { CountUp, paletteOf, fmt } from '../components/kit';
import { go, rememberShop, stampsOf, useKnownShops, useShopState, useWallet } from '../ui';

function ShopTile({ shop, stamps, i }: { shop: Shop; stamps: bigint; i: number }) {
  const { state } = useShopState(shop);
  const p = paletteOf(shop.category);
  const percent = Number((shop.redeem * 10000n) / shop.earn) / 100;
  return (
    <a href={`#${shopPath(shop)}`} className={`shop-tile ${p.tile} fade-in`} style={{ animationDelay: `${i * 50}ms` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="st-ico" style={{ color: p.art }}><Store size={20} /></span>
        <span className="pill" style={{ background: '#fff', color: p.art }}>{percent}%</span>
      </div>
      <div>
        <div className="st-name">{shop.name}</div>
        <div className="kpi" style={{ fontSize: 26, marginTop: 6 }}><CountUp value={Number(stamps)} /><small>stamps</small></div>
      </div>
      <div className="st-meta"><span className="num">{state ? `${fmt(state.reserve)} sats` : '…'}</span><ArrowUpRight size={16} /></div>
    </a>
  );
}

export function Shops() {
  const { wallet, primary } = useWallet();
  const { all } = useKnownShops(primary);
  const [link, setLink] = useState('');
  const parsed = parseShopPath(decodeURIComponent(link.split('#')[1] ?? link).replace(/^.*?(\/s\/)/, '/s/'));

  return (
    <>
      <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {all.map((shop, i) => <ShopTile key={shopPath(shop)} shop={shop} stamps={stampsOf(wallet, shop)} i={i} />)}
      </section>
      <form className="card fade-in" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
        onSubmit={(e) => { e.preventDefault(); if (parsed) { rememberShop(parsed); go(shopPath(parsed)); } }}>
        <Link2 size={20} className="muted" />
        <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Paste a shop link" aria-label="Shop link" value={link} onChange={(e) => setLink(e.target.value.trim())} />
        <button className="btn" disabled={!parsed}>Open</button>
      </form>
    </>
  );
}
