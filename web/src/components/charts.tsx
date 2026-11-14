// Small, dependency-free charts. Each animates in and shows a tooltip on hover.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

const niceMax = (v: number) => {
  if (v <= 0) return 4;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * exp;
};
export const compact = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${Math.round(n)}`;

export interface Point { label: string; value: number }

/** Vertical bars with a dashed grid; the highlighted bar is hatched. */
export function BarChart({ data, height = 220, color, highlight, format = compact, ariaLabel }: {
  data: Point[]; height?: number; color: string; highlight?: number; format?: (n: number) => string; ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0];
  return (
    <div className="bars" style={{ height }} role="img" aria-label={ariaLabel}>
      <div className="y num">{ticks.map((t) => <span key={t}>{format(t)}</span>)}</div>
      <div className="plot">
        <div className="grid-lines">{ticks.map((t) => <span key={t} />)}</div>
        <div className="cols">
          {data.map((d, i) => (
            <div className="col" key={d.label + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {hover === i && <div className="tip num" style={{ left: '50%', top: `calc(${100 - (d.value / max) * 100}% - 30px)` }}>{format(d.value)}</div>}
              <div className="bar-wrap">
                <div className={`bar${i === highlight ? ' hatch' : ''}`} style={{ height: `${(d.value / max) * 100}%`, background: color, animationDelay: `${i * 40}ms` }} />
              </div>
              <div className="x">{d.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Smooth area chart with a crosshair tooltip. */
export function AreaChart({ data, height = 180, color, format = compact, ariaLabel }: {
  data: Point[]; height?: number; color: string; format?: (n: number) => string; ariaLabel: string;
}) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600; const H = 200;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const pts = useMemo(() => data.map((d, i) => [data.length === 1 ? W / 2 : (i / (data.length - 1)) * W, H - (d.value / max) * (H - 12) - 4] as const), [data, max]);
  const line = useMemo(() => {
    if (pts.length < 2) return '';
    let p = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1] ?? pts[i]; const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1]; const [x3, y3] = pts[i + 2] ?? pts[i + 1];
      const c1 = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6]; const c2 = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6];
      p += ` C${c1[0]},${Math.min(H, c1[1])} ${c2[0]},${Math.min(H, c2[1])} ${x2},${y2}`;
    }
    return p;
  }, [pts]);
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)))));
  };
  const at = hover === null ? null : pts[hover];
  const step = Math.ceil(data.length / 7);
  return (
    <div className="area" role="img" aria-label={ariaLabel} style={{ color }}>
      <div ref={ref} style={{ position: 'relative', height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".28" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#9096a1" strokeOpacity=".15" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />)}
          {line && <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#g${id})`} />}
          {line && <path className="line" d={line} pathLength={1} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        </svg>
        {at && hover !== null && (
          <>
            <div className="guide" style={{ left: `${(at[0] / W) * 100}%` }} />
            <div className="dot" style={{ left: `${(at[0] / W) * 100}%`, top: `${(at[1] / H) * 100}%`, background: color }} />
            <div className="tip num" style={{ left: `${(at[0] / W) * 100}%`, top: `calc(${(at[1] / H) * 100}% - 14px)` }}>{data[hover].label} · {format(data[hover].value)}</div>
          </>
        )}
      </div>
      <div className="xs">{data.map((d, i) => (i % step === 0 || i === data.length - 1 ? <span key={i}>{d.label}</span> : null))}</div>
    </div>
  );
}

export function Sparkline({ values, color, height = 40 }: { values: number[]; color: string; height?: number }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${100 - (v / max) * 90 - 5}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Donut progress ring. */
export function Ring({ value, size = 160, stroke = 14, color, track = '#f1f2f4', children }: {
  value: number; size?: number; stroke?: number; color: string; track?: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = setTimeout(() => setShown(Math.max(0, Math.min(1, value))), 60); return () => clearTimeout(t); }, [value]);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown)} />
      </svg>
      <div className="r-center">{children}</div>
    </div>
  );
}

export function SegBar({ parts }: { parts: { value: number; color: string; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="segbar" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
      {parts.map((p) => <span key={p.label} style={{ flexGrow: Math.max(p.value / total, 0.02), background: p.color } as CSSProperties} />)}
    </div>
  );
}

/** Weeks × weekdays grid of activity counts. */
export function Heatmap({ cells, weeks, color }: { cells: number[][]; weeks: string[]; color: string }) {
  const max = Math.max(1, ...cells.flat());
  const [hover, setHover] = useState<string>();
  return (
    <div className="heat" style={{ '--cols': weeks.length } as CSSProperties}>
      {cells.map((row, d) => (
        <div className="heat-row" key={d}>
          {row.map((v, w) => (
            <span key={w} title={`${v} payment${v === 1 ? '' : 's'}`} onMouseEnter={() => setHover(`${weeks[w]} · ${v}`)} onMouseLeave={() => setHover(undefined)}
              style={{ background: v ? color : undefined, opacity: v ? 0.25 + 0.75 * (v / max) : 1 }} />
          ))}
        </div>
      ))}
      <div className="hx">{weeks.map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="muted" style={{ fontSize: 12, minHeight: 16 }}>{hover ?? ' '}</div>
    </div>
  );
}
