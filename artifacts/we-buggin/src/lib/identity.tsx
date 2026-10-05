import type { EmojiIdentity } from '@workspace/api-client-react';
import { isPortraitId } from '@/beam/portraits';
import { IdentityGlyph } from '@/beam/components/IdentityGlyph';
import { beamIdentity } from '@/beam/services/beamService';

export type Identity = EmojiIdentity;

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const emojiImageUrl = (emojiId: string, color: string) =>
  `/api/emojis/${encodeURIComponent(emojiId)}/${color.replace('#', '').toUpperCase()}/image`;

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const t = amt >= 0 ? 255 : 0;
    return Math.round(c + (t - c) * Math.abs(amt));
  });
  return `rgb(${ch.join(',')})`;
}

const CX = 100;
const CY = 112;
const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
};

function spikes(start: number, end: number, n: number, rIn: number, base: number, wobble: number, phase: number) {
  const pts: string[] = [];
  const step = (end - start) / n;
  for (let i = 0; i <= n; i++) {
    const a = start + i * step;
    pts.push(pt(a - step / 2, rIn));
    pts.push(pt(a, base + wobble * Math.sin(i * 2.3 + phase) + (i % 3) * 5));
  }
  pts.push(pt(end + step / 2, rIn));
  return pts.join(' ');
}

const SPIKE_BACK = spikes(158, 382, 15, 48, 82, 10, 0);
const SPIKE_MID = spikes(172, 368, 12, 50, 74, 8, 1.7);
const SPIKE_FRONT = (() => {
  const top: string[] = [];
  for (let a = 200; a <= 340; a += 10) top.push(pt(a, 64));
  const zig: string[] = [];
  for (let i = 0, a = 340; a >= 200; a -= 10, i++) zig.push(pt(a, i % 2 === 0 ? 52 : 34 + (i % 4) * 2));
  return [...top, ...zig].join(' ');
})();

function Ponytail({ c, hi, lo }: { c: string; hi: string; lo: string }) {
  return (
    <g>
      <path d="M50 66 C14 54 -4 96 8 140 C12 156 22 166 24 184 C36 160 44 130 56 84 Z" fill={c} stroke={lo} strokeWidth="1.5" />
      <path d="M44 72 C22 74 14 104 18 136 C26 118 34 100 50 80 Z" fill={hi} opacity=".85" />
      <path d="M30 100 C26 128 28 150 24 178" fill="none" stroke={lo} strokeWidth="1.5" opacity=".6" />
      <ellipse cx="52" cy="72" rx="8" ry="12" transform="rotate(-25 52 72)" fill={lo} />
    </g>
  );
}

interface Props {
  identity: Identity;
  size?: number | string;
  className?: string;
}

/** Static identity art: recolored OpenMoji SVG with hair layered behind and in front. */
export function IdentityAvatar({ identity, size = 120, className }: Props) {
  if (isPortraitId(identity.portraitId)) {
    return <span className={className} data-testid={`img-identity-${identity.gender.toLowerCase()}`}>
      <IdentityGlyph identity={beamIdentity(identity)} size={size} />
    </span>;
  }
  const c = identity.hairColor;
  const hi = shade(c, 0.35);
  const lo = shade(c, -0.35);
  const male = identity.gender === 'Male';
  return (
    <svg
      key={`${identity.emojiId}:${identity.gender}:${identity.color}:${identity.hairColor}`}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label={`${identity.gender} identity`}
      className={className}
      data-testid={`img-identity-${identity.gender.toLowerCase()}`}
    >
      {male ? (
        <g strokeLinejoin="round" strokeWidth="1.5">
          <polygon points={SPIKE_BACK} fill={lo} stroke={lo} />
          <polygon points={SPIKE_MID} fill={c} stroke={lo} />
        </g>
      ) : (
        <g>
          <Ponytail c={c} hi={hi} lo={lo} />
          <g transform="translate(200 0) scale(-1 1)">
            <Ponytail c={c} hi={hi} lo={lo} />
          </g>
          <path d="M42 114 A58 58 0 0 1 158 114 Z" fill={c} stroke={lo} strokeWidth="1.5" />
        </g>
      )}
      <image href={emojiImageUrl(identity.emojiId, identity.color)} x="45" y="57" width="110" height="110" />
      {male ? (
        <polygon points={SPIKE_FRONT} fill={hi} stroke={lo} strokeWidth="1.5" strokeLinejoin="round" />
      ) : (
        <g>
          <path d="M44 108 A56 56 0 0 1 156 108 Q136 78 112 86 Q100 70 88 86 Q64 78 44 108 Z" fill={c} stroke={lo} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M100 58 Q96 74 88 86" fill="none" stroke={lo} strokeWidth="1.5" />
        </g>
      )}
    </svg>
  );
}

export function InitialsBadge({ name, size = 120 }: { name: string; size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-full bg-muted font-display text-3xl font-bold"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function errMessage(e: unknown, fallback = 'Something went wrong. Try again.') {
  const x = e as { data?: { error?: string } | null; message?: string };
  return x?.data?.error ?? x?.message ?? fallback;
}
export const errStatus = (e: unknown) => (e as { status?: number })?.status;
