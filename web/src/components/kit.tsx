import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Loader2, Plus, X, AlertCircle } from 'lucide-react';
import { explorerTx } from '../config';

export const PALETTES = [
  { paper: '#d9defb', art: '#3d4a8a', tile: 'lavender' },
  { paper: '#f8cfae', art: '#9a4f1f', tile: 'peach' },
  { paper: '#c9e3b9', art: '#3f6230', tile: 'mint' },
  { paper: '#f5e3a7', art: '#7d5f0e', tile: 'butter' },
  { paper: '#e6d9f7', art: '#58438a', tile: 'lilac' },
  { paper: '#cfe9e6', art: '#2a625d', tile: 'sage' },
] as const;
export const paletteOf = (category: string) => PALETTES[parseInt(category.slice(0, 2) || '0', 16) % PALETTES.length];

export const sats = (n: bigint | number) => `${Number(n).toLocaleString('en-US')} sats`;
export const fmt = (n: bigint | number) => Number(n).toLocaleString('en-US');
export const shortAddr = (a: string) => { const body = a.split(':').pop() ?? a; return `${body.slice(0, 6)}…${body.slice(-4)}`; };
export const ago = (unix: number) => {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(unix * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
};

/** Animated number. */
export function CountUp({ value, duration = 900, format = fmt }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(); const a = from.current; const b = value;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration); const e = 1 - (1 - k) ** 3;
      setShown(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num">{format(Math.round(shown))}</span>;
}

/** Gradient avatar derived from any string. */
export function Avatar({ seed, size = 36, label }: { seed: string; size?: number; label?: string }) {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360; const b = (a + 50) % 360;
  return (
    <span aria-hidden={!label} aria-label={label} style={{ width: size, height: size, borderRadius: size / 2.6, flex: 'none', display: 'grid', placeItems: 'center',
      background: `linear-gradient(135deg, hsl(${a} 75% 72%), hsl(${b} 70% 52%))`, color: '#fff', fontWeight: 700, fontSize: size * 0.4 }}>
      {label?.[0]?.toUpperCase()}
    </span>
  );
}

/** Tilt an element toward the pointer. */
export function useTilt<T extends HTMLElement>(strength = 10) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current; if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${x * strength}deg) rotateX(${-y * strength}deg) translateY(-2px)`;
    };
    const leave = () => { el.style.transform = ''; };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [strength]);
  return ref;
}

/** Bold geometric art on the right half of the card; the left half stays clear for text. */
function CardArt({ art, variant }: { art: string; variant: number }) {
  return (
    <svg className="l-art" viewBox="0 0 320 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <g transform="translate(190 0)" fill="none" stroke={art} strokeWidth="22" opacity=".92">
        {variant === 0 && <>
          <path d="M10 -10 v70 a45 45 0 0 0 90 0 v-70" />
          <path d="M40 210 v-40 a32 32 0 0 1 64 0 v40" />
          <circle cx="-14" cy="132" r="9" fill={art} stroke="none" />
        </>}
        {variant === 1 && <>
          <circle cx="78" cy="40" r="40" />
          <path d="M150 120 h-60 a38 38 0 0 0 0 76 h60" />
          <circle cx="-10" cy="160" r="9" fill={art} stroke="none" />
        </>}
        {variant === 2 && <>
          <path d="M140 10 h-50 a40 40 0 0 0 0 80 h50" />
          <circle cx="60" cy="168" r="30" />
          <circle cx="-8" cy="60" r="9" fill={art} stroke="none" />
        </>}
      </g>
    </svg>
  );
}

/** A shop's stamp card, drawn like a bank card. */
export function LoyaltyCard({ name, category, stamps, size = 'md', tilt = true, href, testId }: {
  name: string; category: string; stamps: bigint | number; size?: 'md' | 'sm'; tilt?: boolean; href?: string; testId?: string;
}) {
  const p = paletteOf(category);
  const ref = useTilt<HTMLAnchorElement & HTMLDivElement>(tilt ? 10 : 0);
  const n = Number(stamps);
  const filled = n === 0 ? 0 : ((n - 1) % 10) + 1;
  const variant = parseInt(category.slice(2, 4) || '0', 16) % 3;
  const body = (
    <>
      <CardArt art={p.art} variant={variant} />
      <div className="l-top"><span className="l-name">{name}</span></div>
      <div className="l-bottom">
        <div className="l-dots" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}</div>
        <div className="l-count num">{fmt(n)}<small>stamps</small></div>
      </div>
      <span className="sr-only">{`${name}: ${n} stamps`}</span>
    </>
  );
  const style = { '--paper': p.paper, '--art': p.art } as CSSProperties;
  return href
    ? <a ref={ref} href={href} className={`lcard ${size}`} style={style} data-testid={testId}>{body}</a>
    : <div ref={ref} className={`lcard ${size}`} style={style} data-testid={testId}>{body}</div>;
}

export const AddCard = ({ href, label }: { href: string; label: string }) => (
  <a href={href} className="lcard sm add" aria-label={label}><Plus size={22} /></a>
);

export type Notice = { kind: 'ok' | 'error' | 'busy'; text: string; txid?: string };

export function Toast({ notice, onClose }: { notice?: Notice; onClose: () => void }) {
  if (!notice) return null;
  const Icon = notice.kind === 'busy' ? Loader2 : notice.kind === 'ok' ? Check : AlertCircle;
  return (
    <div className="toasts">
      <p className={`notice ${notice.kind}`} role="status">
        <Icon size={18} className={`n-ico${notice.kind === 'busy' ? ' spin' : ''}`} />
        <span>
          {notice.text}{' '}
          {notice.txid && <a href={explorerTx(notice.txid)} target="_blank" rel="noreferrer">View transaction</a>}
        </span>
        {notice.kind !== 'busy' && <button onClick={onClose} aria-label="Dismiss"><X size={16} /></button>}
      </p>
    </div>
  );
}

export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="empty"><div className="e-ico">{icon}</div>{children}</div>;
}
