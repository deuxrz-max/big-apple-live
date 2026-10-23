import { useId } from 'react';
import { giftingTier } from '@workspace/beam-identity';
import { normalizeGiftingLevel } from './gifting';
import './gifting-shield.css';

const SHIELD = 'M24 2.5 L43 9 V24.5 C43 37 34.5 45.5 24 50.5 C13.5 45.5 5 37 5 24.5 V9 Z';
const INNER = 'M24 7.2 L38.6 12.2 V24.6 C38.6 34.6 32 41.5 24 45.6 C16 41.5 9.4 34.6 9.4 24.6 V12.2 Z';

const PALETTES: Record<string, { hi: string; mid: string; lo: string; num: string; glow?: string }> = {
  bronze: { hi: '#F2C49A', mid: '#B9763F', lo: '#6B3D1B', num: '#E6A874' },
  silver: { hi: '#FFFFFF', mid: '#C4CCD6', lo: '#6E7783', num: '#FFFFFF', glow: 'rgba(230,238,250,.55)' },
  gold: { hi: '#FFF0B8', mid: '#E7BC58', lo: '#8A5E17', num: '#FFD978', glow: 'rgba(231,188,88,.45)' },
  platinum: { hi: '#FFFFFF', mid: '#CFE9F7', lo: '#7F9CB0', num: '#EAF8FF', glow: 'rgba(200,236,255,.6)' },
  'deux-wild': { hi: '#C8FFB8', mid: '#39FF14', lo: '#138A00', num: '#5CFF3A', glow: 'rgba(57,255,20,.75)' },
};

export function GiftingShield({ level, size = 18, className = '', decorative = false }: {
  level: number | null | undefined;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const l = normalizeGiftingLevel(level);
  if (l === 0) return null;
  const tier = giftingTier(l);
  const p = PALETTES[tier.key] ?? PALETTES.bronze!;
  const rank = tier.rank;
  const outer = 2.2 + rank * 0.55;
  const inner = 0.7 + rank * 0.25;
  const label = `${tier.name} gifting level ${l}`;
  const fontSize = l >= 100 ? 15 : l >= 10 ? 18 : 21;
  return (
    <span className={`gifting-shield gifting-shield--${tier.key}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size * 1.1 }}
      role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label} title={label}
      data-gifting-level={l} data-gifting-tier={tier.key} data-testid={`badge-gifting-level-${l}`}>
      <svg viewBox="0 0 48 53" width="100%" height="100%" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={`m${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={p.hi} /><stop offset=".45" stopColor={p.mid} />
            <stop offset=".7" stopColor={p.lo} /><stop offset="1" stopColor={p.mid} />
          </linearGradient>
          <radialGradient id={`c${uid}`} cx=".5" cy=".35" r=".75">
            <stop offset="0" stopColor="#2a2418" /><stop offset="1" stopColor="#0c0a07" />
          </radialGradient>
          <pattern id={`t${uid}`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="3" fill="transparent" /><line x1="0" y1="0" x2="0" y2="3" stroke="rgba(255,240,210,.07)" strokeWidth="1" />
          </pattern>
          <clipPath id={`k${uid}`}><path d={SHIELD} /></clipPath>
        </defs>
        <path d={SHIELD} fill={`url(#c${uid})`} />
        <path d={SHIELD} fill={`url(#t${uid})`} />
        {rank >= 4 && <g clipPath={`url(#k${uid})`}><rect className="gifting-shield-shine" x="-30" y="-6" width="14" height="66" fill="rgba(255,255,255,.38)" transform="skewX(-18)" /></g>}
        <path d={SHIELD} fill="none" stroke={`url(#m${uid})`} strokeWidth={outer} strokeLinejoin="round" />
        <path d={INNER} fill="none" stroke={`url(#m${uid})`} strokeWidth={inner} strokeLinejoin="round" opacity={rank >= 2 ? 0.95 : 0.7} />
        {rank >= 3 && <g fill={p.hi}>
          <circle cx="24" cy="4.6" r="1.1" /><circle cx="8.2" cy="11" r=".9" /><circle cx="39.8" cy="11" r=".9" />
        </g>}
        {rank >= 4 && <path d="M15 47 L24 51.5 L33 47" fill="none" stroke={p.hi} strokeWidth=".8" opacity=".8" />}
        {rank >= 5 && <path d={SHIELD} fill="none" stroke={p.mid} strokeWidth=".6" opacity=".9" transform="translate(24 26.5) scale(1.06) translate(-24 -26.5)" />}
        <text x="24" y="28" textAnchor="middle" dominantBaseline="central" fontSize={fontSize}
          fontWeight="900" fill={p.num} className="gifting-shield-number"
          style={p.glow ? { filter: `drop-shadow(0 0 2px ${p.glow})` } : undefined}>{l}</text>
      </svg>
    </span>
  );
}
