import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Github, Heart, Lock, Plus, ShieldCheck, Sparkles, Stamp, Store, Zap } from 'lucide-react';
import { shopPath } from '@regulars/contracts/links';
import '../styles/landing.css';
import { Banner } from '../components/Banner';
import { banner, demoShop } from '../config';
import { statsOf } from '../stats';
import type { ShopEvent } from '../history';
import type { ShopState } from '../wallet';
import { CountUp, LoyaltyCard, ago, fmt } from '../components/kit';
import { go, rememberShop } from '../nav';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Live demo-shop numbers. The chain code loads after first paint, so the page appears at once. */
function useDemoLive() {
  const [state, setState] = useState<ShopState>();
  const [events, setEvents] = useState<ShopEvent[]>();
  useEffect(() => {
    if (!demoShop) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const live = await import('./live');
      const [s, e] = await Promise.all([live.readShop(demoShop!).catch(() => undefined), live.shopHistory(demoShop!).catch(() => undefined)]);
      if (stopped) return;
      if (s) setState(s);
      if (e) setEvents(e);
      timer = setTimeout(load, 20_000);
    };
    load();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return { state, events };
}

/** Fade sections up as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.rv')];
    if (reduced()) { els.forEach((el) => el.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

const SECTIONS = [['how', 'How it works'], ['math', 'The math'], ['shops', 'For shops'], ['protocol', 'Protocol'], ['live', 'Live']] as const;

function Nav({ reserve }: { reserve?: bigint }) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string>();
  const pillsRef = useRef<HTMLDivElement>(null);
  const [glide, setGlide] = useState<CSSProperties>({ opacity: 0 });
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
      let current: string | undefined;
      for (const [id] of SECTIONS) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < window.innerHeight * 0.4) current = id; }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = pillsRef.current?.querySelector<HTMLAnchorElement>(`a[data-id="${active}"]`);
    setGlide(el ? { left: el.offsetLeft, width: el.offsetWidth, opacity: 1 } : { opacity: 0, left: 4, width: 0 });
  }, [active]);
  const jump = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); };
  return (
    <header className={`l-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap">
        <a className="logo" href="#/">regulars<i>.</i></a>
        <div className="pills" ref={pillsRef}>
          <span className="glide" style={glide} />
          {SECTIONS.map(([id, label]) => <a key={id} data-id={id} href={`#/`} onClick={jump(id)} className={active === id ? 'on' : ''}>{label}</a>)}
        </div>
        <span className="live-chip"><i />{reserve === undefined ? 'Live on mainnet' : <><CountUp value={Number(reserve)} /> sats locked</>}</span>
        <a className="l-btn" href="#/app">Launch app<span className="arrow"><ArrowUpRight size={16} /></span></a>
      </div>
    </header>
  );
}

/** Three stamp cards: they lean toward the cursor and shuffle when clicked. */
function CardStack() {
  const [order, setOrder] = useState([0, 1, 2]);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cards = [
    { name: 'Demo Café', category: demoShop?.category ?? '37'.padEnd(64, 'a'), stamps: 7 },
    { name: 'Corner Coffee', category: '1b'.padEnd(64, '2'), stamps: 3 },
    { name: 'Book Nook', category: '5c'.padEnd(64, '7'), stamps: 9 },
  ];
  const pose = [
    { r: -4, x: 0, y: 0, z: 3 },
    { r: 9, x: 26, y: -40, z: 2 },
    { r: -14, x: -34, y: 30, z: 1 },
  ];
  useEffect(() => {
    if (reduced()) return;
    const t = setInterval(() => setOrder((o) => [o[1], o[2], o[0]]), 4200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="stack" role="button" tabIndex={0} aria-label="Shuffle the stamp cards"
      onClick={() => setOrder((o) => [o[1], o[2], o[0]])}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOrder((o) => [o[1], o[2], o[0]]); } }}
      onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 }); }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
      {cards.map((c, i) => {
        const slot = order.indexOf(i); const p = pose[slot];
        return (
          <div key={c.name} className="s-card" style={{ zIndex: p.z, transform: `translate(-50%, -50%) translate(${p.x + tilt.x * (18 - slot * 6)}px, ${p.y + tilt.y * (18 - slot * 6)}px) rotate(${p.r + tilt.x * 6}deg) rotateY(${tilt.x * 14}deg) rotateX(${-tilt.y * 10}deg)` }}>
            <LoyaltyCard name={c.name} category={c.category} stamps={c.stamps} tilt={false} />
          </div>
        );
      })}
      <span className="sticker" style={{ top: '6%', right: '4%' }}>★ live on mainnet</span>
      <span className="coin" style={{ top: '14%', left: '6%' }}>₿</span>
      <span className="coin" style={{ bottom: '16%', right: '8%', animationDelay: '-2s', width: 26, height: 26, fontSize: 11 }}>₿</span>
      <span className="coin" style={{ bottom: '4%', left: '22%', animationDelay: '-4s', width: 22, height: 22, fontSize: 10 }}>₿</span>
      <span className="hint mono">click to shuffle</span>
    </div>
  );
}

function Headline() {
  const words: { t: string; em?: boolean }[] = [{ t: 'Loyalty' }, { t: 'points' }, { t: 'that' }, { t: 'are' }, { t: 'real', em: true }, { t: 'money' }];
  return (
    <h1>
      {words.map((w, i) => (
        <span key={i}>
          <span className="w"><span style={{ '--i': i } as CSSProperties}>{w.em ? <em>{w.t}</em> : w.t}</span></span>{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </h1>
  );
}

/** Giant scrolling words; the scroll wheel speeds them up and flips their direction. */
function Marquee() {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced()) return;
    let x = 0; let dir = -1; let boost = 0; let last = window.scrollY; let raf = 0;
    const onScroll = () => { const d = window.scrollY - last; last = window.scrollY; if (d) dir = d > 0 ? -1 : 1; boost = Math.min(18, boost + Math.abs(d) * 0.08); };
    const tick = () => {
      const el = track.current; if (!el) return;
      const half = el.scrollWidth / 2;
      x += dir * (0.7 + boost); boost *= 0.94;
      if (x <= -half) x += half; if (x > 0) x -= half;
      el.style.transform = `translate3d(${x}px,0,0)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); };
  }, []);
  const item = (
    <div className="item">
      <span>Pay in BCH</span><span className="dot" /><em>earn stamps</em><span className="dot" /><span>Redeem for cash</span><span className="dot" /><em>no servers</em><span className="dot" />
    </div>
  );
  return <div className="marquee" aria-hidden="true"><div className="track" ref={track}>{item}{item}{item}{item}</div></div>;
}

const STEPS = [
  { key: 'Pay', icon: Zap, title: <>Pay in <em>one</em> tap</>, body: 'Open a shop’s page or scan its poster, connect any WizardConnect wallet and pay in Bitcoin Cash. Fees are a fraction of a cent.' },
  { key: 'Earn', icon: Stamp, title: <>Stamps, <em>instantly</em></>, body: 'The shop’s stamps sit in a contract that only releases them in a transaction that also pays the shop. Your payment and your reward are one transaction, so neither can happen without the other.' },
  { key: 'Redeem', icon: ArrowDownLeft, title: <>Cash <em>back</em>, guaranteed</>, body: 'Hand your stamps to the shop’s reward reserve and it releases BCH at a fixed rate. The shop locked that money up front and has no way to refuse you.' },
];

function Orbit() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const DURATION = 4800;
  useEffect(() => {
    if (paused || reduced()) return;
    const t = setTimeout(() => setI((n) => (n + 1) % STEPS.length), DURATION);
    return () => clearTimeout(t);
  }, [i, paused]);
  const angles = [-150, -30, 90];
  const step = STEPS[i];
  return (
    <div className="orbit-wrap" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="orbit rv">
        <div className="ring-line" />
        {STEPS.map((s, n) => {
          const a = ((angles[n] - i * 120) * Math.PI) / 180;
          const Icon = s.icon;
          return (
            <button key={s.key} className={`node${n === i ? ' on' : ''}`} style={{ left: `${50 + 42 * Math.cos(a)}%`, top: `${50 + 42 * Math.sin(a)}%`, transition: 'left .8s cubic-bezier(.2,.8,.2,1), top .8s cubic-bezier(.2,.8,.2,1)' }}
              onClick={() => setI(n)} aria-pressed={n === i}>
              <span className="bubble"><Icon size={n === i ? 30 : 24} /></span><span>{s.key}</span>
            </button>
          );
        })}
        <div className="center">
          <div className="scene fade-swap" key={i}>
            <LoyaltyCard name={demoShop?.name ?? 'Demo Café'} category={demoShop?.category ?? '37'.padEnd(64, 'a')} stamps={i === 0 ? 3 : i === 1 ? 5 : 0} tilt={false} size="sm" />
            {i === 0 && <span className="drop" />}
            {i === 1 && <span className="burst" />}
            {i === 2 && [-40, 0, 40].map((x, k) => <span key={k} className="rise" style={{ '--x': x, '--k': k } as CSSProperties} />)}
          </div>
        </div>
      </div>
      <div className="step-copy rv" style={{ '--d': '120ms' } as CSSProperties}>
        <span className="count">0{i + 1} / 03</span>
        <h3 className="fade-swap" key={`h${i}`}>{step.title}</h3>
        <p className="fade-swap" key={`p${i}`}>{step.body}</p>
        <div className="ctrls">
          <button className="circle-btn" aria-label="Previous step" onClick={() => setI((n) => (n + 2) % 3)}><ArrowLeft size={18} /></button>
          <button className="circle-btn" aria-label="Next step" onClick={() => setI((n) => (n + 1) % 3)}><ArrowRight size={18} /></button>
          <div className="progress">{!paused && <span key={i} style={{ animationDuration: `${DURATION}ms` }} />}</div>
        </div>
      </div>
    </div>
  );
}

function Calculator() {
  const [spend, setSpend] = useState(60_000);
  const [pct, setPct] = useState(3);
  const perStamp = 1000;
  const stamps = Math.floor(spend / perStamp);
  const back = Math.floor((stamps * perStamp * pct) / 100);
  const card = Math.round(spend * 0.029);
  const pctOf = (v: number, min: number, max: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div className="calc">
      <div className="calc-card rv">
        <span className="mono">(drag the sliders)</span>
        <div className="slider">
          <div className="s-top"><label htmlFor="spend">Monthly spend at one shop</label><b className="num">{fmt(spend)} <span className="serif" style={{ fontSize: 20 }}>sats</span></b></div>
          <input id="spend" type="range" min={5000} max={300000} step={5000} value={spend} style={{ '--p': pctOf(spend, 5000, 300000) } as CSSProperties} onChange={(e) => setSpend(+e.target.value)} />
        </div>
        <div className="slider">
          <div className="s-top"><label htmlFor="pct">Cashback the shop offers</label><b className="num">{pct}%</b></div>
          <input id="pct" type="range" min={0.5} max={10} step={0.5} value={pct} style={{ '--p': pctOf(pct, 0.5, 10) } as CSSProperties} onChange={(e) => setPct(+e.target.value)} />
        </div>
        <div className="fees">
          <span className="mono">what the shop pays to take the money</span>
          <div className="s-top" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>Card network (~2.9%)</span><b className="num">{fmt(card)} sats</b></div>
          <div className="bar" style={{ background: '#ead9c8' }}><span style={{ width: '100%', background: '#5a3322' }} /></div>
          <div className="s-top" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>Bitcoin Cash network</span><b className="num">≈ 1 sat / byte</b></div>
          <div className="bar" style={{ background: '#ead9c8' }}><span style={{ width: '2%', background: 'var(--orange)' }} /></div>
        </div>
      </div>
      <div className="calc-card out rv" style={{ '--d': '120ms' } as CSSProperties}>
        <span className="mono" style={{ color: 'rgba(255,250,244,.55)' }}>(your month)</span>
        <div>
          <div className="out-big num"><CountUp value={back} duration={500} /></div>
          <div className="serif" style={{ fontSize: 26, marginTop: 6 }}>sats back, every month</div>
        </div>
        <div className="punch-lg" aria-label={`${stamps} stamps; each dot is 5`}>{Array.from({ length: 20 }, (_, k) => <i key={k} className={k < Math.min(20, Math.ceil(stamps / 5)) ? 'on' : ''} />)}</div>
        <div>
          <div className="out-row"><span>Stamps earned</span><b className="num"><CountUp value={stamps} duration={500} /></b></div>
          <div className="out-row"><span>Yearly cashback</span><b className="num"><CountUp value={back * 12} duration={500} /> sats</b></div>
          <div className="out-row"><span>Card fees the shop avoids</span><b className="num"><CountUp value={card} duration={500} /> sats</b></div>
        </div>
      </div>
    </div>
  );
}

const CODE: { t: string; c?: string }[][] = [
  [{ t: 'function ', c: 'kw' }, { t: 'earn', c: 'fn' }, { t: '() {' }],
  [{ t: '  require', c: 'kw' }, { t: '(output 0 is this issuer);' }],
  [{ t: '  require', c: 'kw' }, { t: '(stampsOut > 0);' }],
  [{ t: '  require', c: 'kw' }, { t: '(fee stays in the issuer);' }],
  [{ t: '  require', c: 'kw' }, { t: '(output 1 pays the shop);' }],
  [{ t: '}' }],
  [{ t: '// payment and reward: one transaction', c: 'cm' }],
];

function Typewriter() {
  const ref = useRef<HTMLDivElement>(null);
  const total = CODE.reduce((s, line) => s + line.reduce((a, p) => a + p.t.length, 0) + 1, 0);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced()) { setN(total); return; }
    let t: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !t) t = setInterval(() => setN((v) => { if (v >= total) { clearInterval(t); return v; } return v + 1; }), 28);
    }, { threshold: 0.4 });
    if (ref.current) io.observe(ref.current);
    return () => { io.disconnect(); if (t) clearInterval(t); };
  }, [total]);
  let left = n;
  return (
    <div className="codebox" ref={ref} aria-label="StampIssuer.cash earn function">
      <div className="c-head"><i /><i /><i /><span>StampIssuer.cash</span></div>
      {CODE.map((line, li) => {
        const parts = line.map((p, pi) => { const shown = p.t.slice(0, Math.max(0, left)); left -= p.t.length; return <span key={pi} className={p.c}>{shown}</span>; });
        left -= 1;
        return <div key={li} style={{ minHeight: '1.75em' }}>{parts}{left < 0 && left > -2 && <span className="caret" />}</div>;
      })}
      {n >= total && <span className="caret" />}
    </div>
  );
}

function SpinBadge() {
  return (
    <a className="badge-spin" href={banner.repo || '#/'} target="_blank" rel="noreferrer" aria-label="Read the code on GitHub">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><path id="circ" d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" /></defs>
        <text fill="currentColor" style={{ font: '500 10.5px JetBrains Mono, monospace', letterSpacing: '.24em', textTransform: 'uppercase' }}>
          <textPath href="#circ">open source · read the code · open source · read the code ·</textPath>
        </text>
      </svg>
      <span className="core"><Github size={22} /></span>
    </a>
  );
}

export function Landing() {
  useReveal();
  const { state, events } = useDemoLive();
  const [saved, setSaved] = useState(false);
  const [shopName, setShopName] = useState('');
  const lifetime = useMemo(() => statsOf(events ?? []), [events]);
  const recent = (events ?? []).filter((e) => e.kind === 'earn' || e.kind === 'redeem').slice(0, 5);
  const percent = demoShop ? Number((demoShop.redeem * 10000n) / demoShop.earn) / 100 : 3;
  const openDemo = () => { if (demoShop) go(shopPath(demoShop)); else go('/app'); };

  return (
    <div className="land">
      <Banner />
      <Nav reserve={state?.reserve} />

      <main className="wrap hero">
        <section className="hero-grid">
          <div className="hero-card">
            <div className="hero-copy">
              <span className="mono">(new · live on bitcoin cash mainnet)</span>
              <Headline />
              <p className="lede rv in" style={{ '--d': '500ms' } as CSSProperties}>Pay a shop in Bitcoin Cash and get its loyalty stamps in the same transaction. Redeem them for BCH from a reserve the shop locked up front.</p>
              <div className="hero-ctas">
                <button className="l-btn" onClick={openDemo}>Try the demo shop<span className="arrow"><ArrowRight size={16} /></span></button>
                <a className="l-link" href="#/app/new">Open a shop</a>
              </div>
              <div className="stats">
                <div><b className="num">1 tx</b><span className="mono">pay + earn</span></div>
                <div><b className="num">{percent}%</b><span className="mono">back at demo café</span></div>
                <div><b className="num">0</b><span className="mono">servers</span></div>
              </div>
            </div>
            <CardStack />
          </div>

          <div className="side-col">
            <a className="feat" href={demoShop ? `#${shopPath(demoShop)}` : '#/app'} data-testid="demo-shop">
              <div className="f-top">
                <span className="tag">(featured)</span>
                <button className={`heart${saved ? ' on' : ''}`} aria-label="Save shop" aria-pressed={saved}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSaved((s) => !s); if (demoShop) rememberShop(demoShop); }}><Heart size={16} fill={saved ? 'currentColor' : 'none'} /></button>
              </div>
              <LoyaltyCard name={demoShop?.name ?? 'Demo Café'} category={demoShop?.category ?? '37'.padEnd(64, 'a')} stamps={lifetime.redeemed % 10n || 4n} size="sm" />
              <div className="f-foot">
                <div>
                  <h3>{demoShop?.name ?? 'Demo Café'}</h3>
                  <div className="f-meta">Reserve · <span data-testid="demo-reserve" className="num">{state ? `${fmt(state.reserve)} sats` : '…'}</span></div>
                </div>
                <span className="plus-btn"><Plus size={20} /></span>
              </div>
            </a>
            <div className="mini-row">
              <a className="mini dark" href="#/app/new">
                <span className="mono" style={{ color: 'rgba(255,250,244,.55)' }}>(for shops)</span>
                <span className="big">1<span className="serif" style={{ fontSize: '.6em', color: 'var(--paper)' }}>min</span></span>
                <p>to open your own programme from your wallet</p>
                <span className="go"><ArrowUpRight size={18} /></span>
              </a>
              <a className="mini orange" href="#live">
                <div className="faces">{(recent.length ? recent : [0, 1, 2, 3]).slice(0, 4).map((_, k) => <span key={k} style={{ background: `hsl(${20 + k * 40} 70% ${60 + k * 5}%)` }} />)}</div>
                <span className="big num"><CountUp value={Number(lifetime.issued)} /></span>
                <p>stamps issued at the demo café, on-chain</p>
              </a>
            </div>
          </div>
        </section>
      </main>

      <Marquee />

      <section className="sec wrap" id="how">
        <div className="sec-head rv">
          <div><span className="mono">(the loop)</span><h2>How it <em>works</em></h2></div>
          <p>Three steps, two contracts. Click a step or let it play.</p>
        </div>
        <Orbit />
      </section>

      <section className="sec wrap" id="math">
        <div className="sec-head rv">
          <div><span className="mono">(the math)</span><h2>Card fees, <em>returned</em></h2></div>
          <p>Shops lose about 3% of every card sale. With Bitcoin Cash they keep it, and can hand part of it back to the customers who return.</p>
        </div>
        <Calculator />
      </section>

      <section className="sec wrap" id="shops">
        <div className="sec-head rv">
          <div><span className="mono">(for shops)</span><h2>Built for <em>shops</em></h2></div>
          <p>A loyalty programme with nothing to install and nothing to run. Hover a card.</p>
        </div>
        <div className="proc">
          {[
            { cls: 'dark', icon: Sparkles, t: 'Open in a minute', d: 'One transaction from your wallet mints a million stamps into the issuing contract and funds your reward reserve. You get a link and a QR poster.' },
            { cls: 'tan', icon: Lock, t: 'Reserve locked', d: 'Your reward money sits in a contract that pays a fixed rate per stamp. Customers can trust it because you cannot pull it from under them while they hold stamps.' },
            { cls: 'dark', icon: Store, t: 'No hardware', d: 'No card terminal, no app, no customer database. Payments land straight in your wallet, and analytics read from the chain.' },
          ].map(({ cls, icon: Icon, t, d }, k) => (
            <div key={t} className={`pcard ${cls} rv`} style={{ '--d': `${k * 100}ms` } as CSSProperties} tabIndex={0}>
              <span className="p-num">0{k + 1}</span>
              <span className="p-ico"><Icon size={30} /></span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sec wrap" id="protocol">
        <div className="band rv">
          <div>
            <span className="mono">(the protocol)</span>
            <h2>Two contracts. <em>Zero</em> servers.</h2>
            <p>StampIssuer releases a shop’s stamps only to a transaction that pays the shop. RewardReserve pays a fixed amount of BCH for every stamp handed in. Each shop is fully described by its link, so there is nothing to register and nothing to host.</p>
            <div className="facts">
              <div><b>CashTokens</b><span>stamps are a fungible token</span></div>
              <div><b>WizardConnect</b><span>one signature in your wallet</span></div>
              <div><b>1% fee</b><span>enforced by the contract itself</span></div>
              <div><b>XO template</b><span>earn and redeem from XO wallets</span></div>
            </div>
          </div>
          <Typewriter />
          <SpinBadge />
        </div>
      </section>

      <section className="sec wrap" id="live">
        <div className="sec-head rv">
          <div><span className="mono">(right now, on-chain)</span><h2>Happening <em>live</em></h2></div>
          <p>Read straight from the demo café’s contracts on Bitcoin Cash mainnet. No database involved.</p>
        </div>
        <div className="live">
          <div className="live-stats">
            {[
              ['Reserve', state ? Number(state.reserve) : 0, 'sats locked'],
              ['Payments', lifetime.payments, 'paid & rewarded'],
              ['Redeemed', Number(lifetime.redeemed), 'stamps cashed out'],
              ['Revenue', Number(lifetime.revenue), 'sats to the shop'],
            ].map(([label, v, sub], k) => (
              <div key={label as string} className="lstat rv" style={{ '--d': `${k * 80}ms` } as CSSProperties}>
                <span className="mono">({label as string})</span>
                <b className="num"><CountUp value={v as number} /></b>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{sub as string}</span>
              </div>
            ))}
          </div>
          <div className="feed rv" style={{ '--d': '120ms' } as CSSProperties}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="mono">(latest at {demoShop?.name ?? 'the demo café'})</span><span className="live-chip" style={{ display: 'inline-flex', padding: '6px 10px' }}><i />live</span>
            </div>
            {recent.length === 0 && <p style={{ color: 'var(--muted)', margin: 12 }}>Waiting for the first payment…</p>}
            {recent.map((e, k) => (
              <a key={e.txid} className="feed-row" style={{ animationDelay: `${k * 70}ms` }} href={demoShop ? `#${shopPath(demoShop)}` : '#/app'}>
                <span className="fi" style={{ background: e.kind === 'earn' ? 'var(--peach)' : '#e3efe0', color: e.kind === 'earn' ? 'var(--orange-2)' : '#3f6230' }}>{e.kind === 'earn' ? <Stamp size={20} /> : <ArrowDownLeft size={20} />}</span>
                <span><b>{e.kind === 'earn' ? `Paid · +${fmt(e.stamps)} stamps` : `Redeemed ${fmt(e.stamps)} stamps`}</b><small>{ago(e.time)}{e.pending ? ' · confirming' : ''}</small></span>
                <span className="amt">{e.kind === 'earn' ? '' : '+'}{fmt(e.sats)} sats</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="sec wrap">
        <div className="cta rv">
          <div>
            <span className="mono">(open your shop)</span>
            <h2>Give your regulars a <em>reason</em>.</h2>
            <p style={{ color: '#4a3328', fontSize: 16, lineHeight: 1.55, maxWidth: '40ch', marginBottom: 24 }}>Name your shop and we’ll set up the rest in the app. Opening takes one signature.</p>
            <form onSubmit={(e) => { e.preventDefault(); try { sessionStorage.setItem('regulars-prefill-name', shopName.trim()); } catch { /* ignore */ } go('/app/new'); }}>
              <input placeholder="Your shop's name" aria-label="Your shop's name" value={shopName} maxLength={40} onChange={(e) => setShopName(e.target.value)} />
              <button>START</button>
            </form>
          </div>
          <div className="cta-art" aria-hidden="true">
            <div style={{ position: 'absolute', right: '6%', top: '4%', transform: 'rotate(8deg)' }}><LoyaltyCard name={shopName.trim() || 'Your shop'} category={'e8'.padEnd(64, '4')} stamps={shopName.length % 10} /></div>
            <div style={{ position: 'absolute', left: '2%', bottom: '2%', transform: 'rotate(-7deg)' }}><LoyaltyCard name="Regulars" category={'2a'.padEnd(64, '1')} stamps={10} tilt={false} /></div>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <a className="logo" href="#/">regulars<i>.</i></a>
              <p>Loyalty points that are real money. Built on Bitcoin Cash for BCH BLAZE 2026.</p>
            </div>
            <div><h4>App</h4><ul><li><a href="#/app">Dashboard</a></li><li><a href="#/app/new">Open a shop</a></li>{demoShop && <li><a href={`#${shopPath(demoShop)}`}>Demo café</a></li>}</ul></div>
            <div><h4>Project</h4><ul>{banner.repo && <li><a href={banner.repo} target="_blank" rel="noreferrer">Source code</a></li>}{banner.deck && <li><a href={banner.deck} target="_blank" rel="noreferrer">Presentation</a></li>}{banner.repo && <li><a href={`${banner.repo}/tree/main/xo`} target="_blank" rel="noreferrer">XO template</a></li>}</ul></div>
            <div><h4>Trust</h4><ul><li><a href="#protocol" onClick={(e) => { e.preventDefault(); document.getElementById('protocol')?.scrollIntoView({ behavior: 'smooth' }); }}>How it’s enforced</a></li><li><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'rgba(255,250,244,.7)', fontSize: 14 }}><ShieldCheck size={16} />Non-custodial</span></li></ul></div>
          </div>
          <div className="giant" aria-hidden="true">regulars.</div>
          <div className="legal"><span>Open source · no accounts · no servers</span><span>BCH BLAZE 2026</span></div>
        </div>
      </footer>
    </div>
  );
}
