import { useId } from 'react';
import { DOT, RING, SEAL, STEM } from './logoPaths';

/** The Regulars mark: a loyalty seal with a stamped r. On hover the seal turns; the r stays upright. */
export function Logo({ size = 32, ring = true }: { size?: number; ring?: boolean }) {
  const id = useId().replace(/:/g, '');
  const r = (fill: string, opacity: number, dy: number) => (
    <g transform={`translate(1.6 ${dy})`} opacity={opacity}>
      <path d={STEM} fill="none" stroke={fill} strokeWidth={6.2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill={fill} />
    </g>
  );
  return (
    <svg className="rg-logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="14" y1="6" x2="50" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f7a26b" /><stop offset=".5" stopColor="#ec7a3f" /><stop offset="1" stopColor="#d45a22" />
        </linearGradient>
        <radialGradient id={`h${id}`} cx="24" cy="16" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="rg-seal">
        <path d={SEAL} fill={`url(#g${id})`} />
        {ring && <circle cx={RING.cx} cy={RING.cy} r={RING.r} fill="none" stroke="#fff8ef" strokeOpacity=".5" strokeWidth={1} strokeDasharray="0.01 2.9" strokeLinecap="round" />}
      </g>
      <path d={SEAL} fill={`url(#h${id})`} />
      {r('#9c3f12', 0.35, 1.1)}
      {r('#fff8ef', 1, 0)}
    </svg>
  );
}
