import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowDownRight, ArrowUpRight, ChevronDown, Copy, Plus, Printer, Store, Check } from 'lucide-react';
import { shopPath, type Shop } from '@regulars/contracts';
import { daily, statsOf, type ShopEvent } from '../history';
import { readWallet, fundReserve } from '../wallet';
import { AreaChart, Heatmap, Ring, SegBar } from '../components/charts';
import { Avatar, CountUp, Empty, Toast, ago, fmt, sats } from '../components/kit';
import { go, keyOf, useAction, useHistory, useKnownShops, useShopState, useWallet } from '../ui';

const RANGES = [{ k: '1W', d: 7 }, { k: '1M', d: 30 }, { k: '3M', d: 90 }] as const;

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return <span className={`pill ${pct >= 0 ? 'good' : 'bad'}`}>{pct >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(pct)}%</span>;
}

function ShopPicker({ shops, current }: { shops: Shop[]; current: Shop }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar seed={current.category} size={24} label={current.name} />{current.name}<ChevronDown size={16} />
      </button>
      {open && (
        <div className="menu" role="menu" style={{ top: 50, left: 0 }}>
          {shops.map((s) => (
            <button key={keyOf(s)} role="menuitem" onClick={() => { setOpen(false); go(`/app/manage${shopPath(s)}`); }}>
              <Avatar seed={s.category} size={22} label={s.name} />{s.name}{keyOf(s) === keyOf(current) && <Check size={14} style={{ marginLeft: 'auto' }} />}
            </button>
          ))}
          <a href="#/app/new"><Plus size={16} />Open a shop</a>
        </div>
      )}
    </div>
  );
}

function weeksGrid(events: ShopEvent[], weeks = 12) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cells = Array.from({ length: 7 }, () => Array<number>(weeks).fill(0));
  const firstMonday = new Date(today); firstMonday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
  for (const e of events) {
    if (e.kind !== 'earn') continue;
    const d = new Date(e.time * 1000); d.setHours(0, 0, 0, 0);
    const w = Math.floor((d.getTime() - firstMonday.getTime()) / (7 * 864e5));
    if (w >= 0 && w < weeks) cells[(d.getDay() + 6) % 7][w] += 1;
  }
  const labels = Array.from({ length: weeks }, (_, w) => { const d = new Date(firstMonday); d.setDate(d.getDate() + w * 7); return w % 2 ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); });
  return { cells, labels };
}

export function Manage({ shop: requested }: { shop?: Shop }) {
  const { manager, primary, refresh: refreshWallet } = useWallet();
  const { all, mine } = useKnownShops(primary);
  const choices = useMemo(() => { const m = new Map<string, Shop>(); for (const s of [...mine, ...all.slice(0, 1)]) m.set(keyOf(s), s); return [...m.values()]; }, [mine, all]);
  const shop = requested ?? choices[0];
  const { state, refresh: refreshShop } = useShopState(shop);
  const { events, refresh: refreshHistory } = useHistory(shop);
  const { notice, run, busy, clear } = useAction(() => Promise.all([refreshWallet(), refreshShop(), refreshHistory()]));
  const [range, setRange] = useState<number>(30);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const link = shop ? `${location.origin}/#${shopPath(shop)}` : '';
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(setQr); }, [link]);

  if (!shop) return <div className="card"><Empty icon={<Store size={22} />}><span>No shop yet</span><a className="btn" href="#/app/new">Open a shop</a></Empty></div>;

  const now = Date.now() / 1000;
  const list = events ?? [];
  const cur = statsOf(list, now - range * 86400);
  const prev = statsOf(list.filter((e) => e.time < now - range * 86400), now - 2 * range * 86400);
  const lifetime = statsOf(list);
  const revenueSeries = daily(list.filter((e) => e.kind === 'earn'), range, (e) => Number(e.sats));
  const held = lifetime.issued - lifetime.redeemed;
  const funded = Number((state?.reserve ?? 0n) + lifetime.rewardsPaid);
  const reserveShare = funded ? Number(state?.reserve ?? 0n) / funded : 0;
  const { cells, labels } = weeksGrid(list);
  const isMine = Boolean(mine.find((s) => keyOf(s) === keyOf(shop)));

  const topUp = (amount: bigint) => run('Approve the top-up in your wallet…', async () => {
    const w = await readWallet(manager!);
    const txid = await fundReserve(manager!, w, shop, amount);
    return { kind: 'ok', text: `Added ${sats(amount)} to the reserve.`, txid };
  });

  return (
    <>
      <div className="fade-in" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <ShopPicker shops={choices} current={shop} />
        {!isMine && <span className="pill neutral">Public data</span>}
        <span style={{ flex: 1 }} />
        <div className="seg">{RANGES.map((r) => <button key={r.k} className={range === r.d ? 'on' : ''} onClick={() => setRange(r.d)}>{r.k}</button>)}</div>
        <a className="btn" href={`#${shopPath(shop)}`}><Store size={16} />Shop page</a>
      </div>

      <section className="grid g-3">
        <div className="card fade-in" data-testid="revenue">
          <div className="card-head"><h2>Revenue</h2><span className="spacer" /><Delta now={Number(cur.revenue)} before={Number(prev.revenue)} /></div>
          <div className="kpi"><CountUp value={Number(cur.revenue)} /><small>sats</small></div>
          <div style={{ margin: '16px -4px 6px' }}><AreaChart data={revenueSeries} height={130} color="var(--accent)" ariaLabel="Revenue per day" /></div>
          <div className="rows" style={{ marginTop: 10 }}>
            {[['Payments', cur.payments, prev.payments], ['Customers', cur.customers, prev.customers], ['Avg ticket', cur.payments ? Number(cur.revenue) / cur.payments : 0, prev.payments ? Number(prev.revenue) / prev.payments : 0]].map(([label, a, b]) => (
              <div key={label as string} className="sum-row" style={{ padding: '8px 2px' }}>
                <span>{label}</span><span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><b className="num">{fmt(Math.round(a as number))}</b><Delta now={a as number} before={b as number} /></span>
              </div>
            ))}
          </div>
        </div>

        <div className="card fade-in" style={{ animationDelay: '60ms' }}>
          <div className="card-head"><h2>Stamps</h2><span className="spacer" /><span className="pill accent">{lifetime.issued ? Math.round((Number(lifetime.redeemed) / Number(lifetime.issued)) * 100) : 0}% redeemed</span></div>
          <div className="kpi"><CountUp value={Number(lifetime.issued)} /><small>issued</small></div>
          <div className="grid g-2" style={{ gap: 0, margin: '22px 0 18px', borderTop: '1px solid var(--line)' }}>
            {[['Held', held, 'var(--accent)'], ['Redeemed', lifetime.redeemed, '#7c6cf2']].map(([label, v, c], i) => (
              <div key={label as string} style={{ padding: '16px 0 0', paddingLeft: i ? 16 : 0, borderLeft: i ? '1px solid var(--line)' : undefined, display: 'grid', gap: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>{label as string}</span>
                <b style={{ fontSize: 24, letterSpacing: '-.02em' }} className="num">{lifetime.issued ? Math.round((Number(v) / Number(lifetime.issued)) * 100) : 0}%</b>
                <span className="num muted" style={{ fontSize: 12.5 }}>{fmt(v as bigint)}</span>
                <span style={{ height: 6, borderRadius: 3, background: c as string }} />
              </div>
            ))}
          </div>
          <SegBar parts={[{ label: 'Held', value: Number(held), color: 'var(--accent)' }, { label: 'Redeemed', value: Number(lifetime.redeemed), color: '#7c6cf2' }]} />
          <div className="sum-row" style={{ marginTop: 14, padding: '8px 2px' }}><span>Left to issue</span><b className="num">{state ? fmt(state.stampsLeft) : '…'}</b></div>
        </div>

        <div className="card fade-in" style={{ animationDelay: '120ms', display: 'grid', gap: 16 }}>
          <div className="card-head" style={{ margin: 0 }}><h2>Reserve</h2><span className="spacer" /><span className="pill good">Locked</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Ring value={reserveShare} size={132} stroke={13} color="var(--accent)">
              <b className="num">{Math.round(reserveShare * 100)}%</b><small>left</small>
            </Ring>
            <div style={{ display: 'grid', gap: 6 }}>
              <span className="kpi" style={{ fontSize: 24 }}>{state ? <CountUp value={Number(state.reserve)} /> : '…'}<small>sats</small></span>
              <span className="muted num" style={{ fontSize: 13 }}>covers {state ? fmt(state.reserve / shop.redeem) : '…'} stamps</span>
              <span className="muted num" style={{ fontSize: 13 }}>paid out {fmt(lifetime.rewardsPaid)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[10_000n, 50_000n, 100_000n].map((a) => (
              <button key={String(a)} className="btn ghost" style={{ flex: 1, minWidth: 90 }} disabled={!manager || busy} onClick={() => topUp(a)}>+{fmt(a / 1000n)}k</button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid g-3">
        <div className="card fade-in">
          <div className="card-head"><h2>Activity</h2><span className="spacer" /><span className="muted" style={{ fontSize: 12.5 }}>12 weeks</span></div>
          <Heatmap cells={cells} weeks={labels} color="var(--accent)" />
        </div>
        <div className="card fade-in" style={{ gridColumn: 'span 1' }}>
          <div className="card-head"><h2>Payments</h2></div>
          {list.filter((e) => e.kind === 'earn').length === 0 && <Empty icon={<Store size={22} />}>No payments yet</Empty>}
          <div className="rows">
            {list.filter((e) => e.kind === 'earn').slice(0, 6).map((e) => (
              <div key={e.txid} className="row">
                <Avatar seed={e.customer ?? e.txid} size={36} />
                <span className="r-main"><b className="num">+{fmt(e.stamps)} stamps</b><small>{ago(e.time)}{e.pending ? ' · pending' : ''}</small></span>
                <span className="r-amt num plus">+{fmt(e.sats)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card fade-in" style={{ display: 'grid', gap: 14, justifyItems: 'center', alignContent: 'start' }}>
          <div className="card-head" style={{ width: '100%', margin: 0 }}><h2>Share</h2></div>
          {qr && <img className="qr" src={qr} alt={`QR code for ${shop.name}`} />}
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Link'}</button>
            <a className="btn" style={{ flex: 1 }} href={`#/poster${shopPath(shop).slice(2)}`}><Printer size={16} />Poster</a>
          </div>
        </div>
      </section>
      <Toast notice={notice} onClose={clear} />
    </>
  );
}
