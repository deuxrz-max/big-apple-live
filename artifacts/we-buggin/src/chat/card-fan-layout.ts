/** Pure geometry for the expanded (profile popup) card fan. Accounts for rotated bounding boxes. */
export const CARD_ASPECT = 53 / 76; // width / height of uploaded faces
export const EXPOSE_RATIO = 0.34; // share of each card left exposed (step = width * 0.34)
export const ANGLE_STEP = 3.5; // degrees per position
export const MAX_CARD_W = 260;
export const MIN_CARD_W = 40;

export interface FanCardPos { left: number; top: number; angle: number }
export interface FanLayout { cardW: number; cardH: number; step: number; width: number; height: number; cards: FanCardPos[] }

const rad = (d: number) => (d * Math.PI) / 180;

/** Place n cards (pivot = bottom centre, matching CSS transform-origin 50% 100%) and measure rotated bounds. */
function place(n: number, w: number) {
  const h = w / CARD_ASPECT;
  const step = n > 1 ? w * EXPOSE_RATIO : 0;
  const mid = (n - 1) / 2;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const raw = Array.from({ length: n }, (_, i) => {
    const o = i - mid;
    const angle = o * ANGLE_STEP;
    const px = i * step, py = o * o * h * 0.018; // outer cards drop slightly
    const c = Math.cos(rad(angle)), s = Math.sin(rad(angle));
    for (const [x, y] of [[-w / 2, 0], [w / 2, 0], [-w / 2, -h], [w / 2, -h]]) {
      const rx = px + x * c - y * s, ry = py + x * s + y * c;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
    return { px, py, angle };
  });
  return { h, step, raw, minX, minY, width: maxX - minX, height: maxY - minY };
}

export function getExpandedFanLayout(count: number, availW: number, availH: number): FanLayout {
  const n = Math.max(0, Math.min(5, Math.floor(count)));
  if (!n) return { cardW: 0, cardH: 0, step: 0, width: 0, height: 0, cards: [] };
  let lo = MIN_CARD_W, hi = MAX_CARD_W;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2, p = place(n, m);
    if (p.width <= availW && p.height <= availH) lo = m; else hi = m;
  }
  const cardW = Math.floor(lo);
  const p = place(n, cardW);
  const cards = p.raw.map(r => ({
    left: r.px - cardW / 2 - p.minX,
    top: r.py - p.h - p.minY,
    angle: r.angle,
  }));
  return { cardW, cardH: p.h, step: p.step, width: Math.ceil(p.width), height: Math.ceil(p.height), cards };
}

/** Largest card that fits a box without distortion. */
export function fitCard(availW: number, availH: number) {
  const width = Math.max(MIN_CARD_W, Math.floor(Math.min(availW, availH * CARD_ASPECT)));
  return { width, height: Math.floor(width / CARD_ASPECT) };
}
