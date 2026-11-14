import { useMemo, useState } from 'react';
import { ArrowUpRight, Coins, Stamp, Store, Wallet as WalletIcon, Gift, ArrowDownLeft } from 'lucide-react';
import { shopPath } from '@regulars/contracts';
import { demoShop } from '../config';
import { daily } from '../history';
import { BarChart } from '../components/charts';
import { AddCard, CountUp, Empty, LoyaltyCard, ago, fmt, paletteOf } from '../components/kit';
import { stampsOf, useHistories, useKnownShops, useWallet, useWalletConnection } from '../ui';

const RANGES = [7, 12, 30] as const;

export function Overview() {
  const wc = useWalletConnection();
  const { wallet, pkhs, primary, manager } = useWallet();
  const { all } = useKnownShops(primary);
  const { events } = useHistories(all.slice(0, 8));
  const [days, setDays] = useState<number>(12);
  const connected = Boolean(manager);

  const mine = useMemo(() => (events ?? []).filter((e) => e.customer && pkhs.has(e.customer)), [events, pkhs]);
  const held = all.map((shop) => ({ shop, stamps: stampsOf(wallet, shop) }));
  const totalStamps = held.reduce((s, h) => s + h.stamps, 0n);
  const cashback = held.reduce((s, h) => s + h.stamps * h.shop.redeem, 0n);
  const withStamps = held.filter((h) => h.stamps > 0n);

  // Personal activity once connected; the demo shop's network activity otherwise.
  const source = connected ? mine : (events ?? []).filter((e) => demoShop && e.shop.category === demoShop.category);
  const series = daily(source.filter((e) => e.kind === 'earn'), days, (e) => Number(e.stamps));
  const periodTotal = series.reduce((s, b) => s + b.value, 0);
  const prev = daily(source.filter((e) => e.kind === 'earn'), days * 2, (e) => Number(e.stamps)).slice(0, days).reduce((s, b) => s + b.value, 0);
  const change = prev ? Math.round(((periodTotal - prev) / prev) * 100) : null;

  const tiles = [
    { label: 'Balance', value: wallet ? Number(wallet.bch) : null, unit: 'sats', cls: 'peach', href: '#/app/activity', icon: WalletIcon },
    { label: 'Stamps', value: connected ? Number(totalStamps) : null, unit: '', cls: 'mint', href: '#/app/shops', icon: Stamp },
    { label: 'Cashback', value: connected ? Number(cashback) : null, unit: 'sats', cls: 'lavender', href: '#/app/shops', icon: Gift },
    { label: 'Shops', value: all.length, unit: '', cls: 'sage', href: '#/app/shops', icon: Store },
  ];

  return (
    <>
      <div className="fade-in" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: '-.03em' }}>{connected ? 'Welcome back' : 'Welcome'}</h2>
        {!connected && <button className="btn accent" onClick={() => wc.connect()} disabled={wc.state === 'connecting'} style={{ marginLeft: 'auto' }}><WalletIcon size={16} />Connect to see your stamps</button>}
      </div>

      <section className="grid g-hero">
        <div className="tiles">
          {tiles.map(({ label, value, unit, cls, href, icon: Icon }, i) => (
            <a key={label} href={href} className={`tile ${cls} fade-in`} style={{ animationDelay: `${i * 60}ms` }} data-testid={`tile-${label.toLowerCase()}`}>
              <span className="t-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon size={16} />{label}</span>
              <span className="t-go"><ArrowUpRight size={18} /></span>
              <span className="t-value">{value === null ? '—' : <CountUp value={value} />}{value !== null && unit && <small>{unit}</small>}</span>
            </a>
          ))}
        </div>
        <div className="card feature fade-in" style={{ animationDelay: '120ms' }}>
          <div className="card-head">
            <h2>{connected ? 'Stamps earned' : `${demoShop?.name ?? 'Network'} · stamps`}</h2>
            <span className="spacer" />
            <div className="seg" style={{ background: 'rgba(255,255,255,.18)' }}>
              {RANGES.map((r) => <button key={r} className={days === r ? 'on' : ''} onClick={() => setDays(r)} style={days === r ? {} : { color: '#fff' }}>{r}d</button>)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className="kpi"><CountUp value={periodTotal} /></span>
            {change !== null && <span className="chip">{change >= 0 ? '+' : ''}{change}%</span>}
          </div>
          <BarChart data={series} height={230} color="var(--cream)" highlight={series.length - 1} ariaLabel="Stamps earned per day" />
        </div>
      </section>

      <section className="grid g-split">
        <div className="card fade-in" style={{ animationDelay: '160ms' }}>
          <div className="card-head"><h2>Recent</h2><span className="spacer" /><a href="#/app/activity" className="muted" style={{ fontSize: 13 }}>All</a></div>
          {connected && mine.length === 0 && <Empty icon={<Coins size={22} />}>No payments yet</Empty>}
          {!connected && <Empty icon={<WalletIcon size={22} />}>Connect a wallet</Empty>}
          <div className="rows">
            {mine.slice(0, 6).map((e) => {
              const p = paletteOf(e.shop.category);
              const earn = e.kind === 'earn';
              return (
                <a key={e.txid} className="row" href={`#${shopPath(e.shop)}`}>
                  <span className="r-ico" style={{ background: p.paper, color: p.art }}>{earn ? <Stamp size={20} /> : <ArrowDownLeft size={20} />}</span>
                  <span className="r-main"><b>{e.shop.name}</b><small>{earn ? 'Paid' : 'Redeemed'} · {ago(e.time)}</small></span>
                  <span className="r-amt num">
                    <span className={earn ? 'minus' : 'plus'}>{earn ? '−' : '+'}{fmt(e.sats)}</span>
                    <small>{earn ? '+' : '−'}{fmt(e.stamps)} stamps</small>
                  </span>
                </a>
              );
            })}
          </div>
        </div>

        <div className="card fade-in" style={{ animationDelay: '200ms' }}>
          <div className="card-head"><h2>Your cards</h2><span className="spacer" /><a href="#/app/shops" className="muted" style={{ fontSize: 13 }}>Shops</a></div>
          <div className="cards-row">
            {(withStamps.length ? withStamps : held.slice(0, 3)).map(({ shop, stamps }) => (
              <LoyaltyCard key={shop.category} name={shop.name} category={shop.category} stamps={stamps} size="sm" href={`#${shopPath(shop)}`} />
            ))}
            <AddCard href="#/app/shops" label="Find a shop" />
          </div>
        </div>
      </section>
    </>
  );
}
