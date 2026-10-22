/** Pure helpers for the owner-only single-Joker WebGL preview. No DOM, no three, no network. */
export const JOKER_ART_W = 500;
export const JOKER_ART_H = 711;
export const JOKER_CARD_W = 1;
export const JOKER_CARD_H = JOKER_ART_H / JOKER_ART_W;
export const JOKER_MAX_TILT_DEG = 12;
export const JOKER_DPR_CAP = 1.5;
export const JOKER_CODE = "joker-wild-1";

export type JokerTilt = { rx: number; ry: number };
export const JOKER_REST: JokerTilt = { rx: 0, ry: 0 };

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, fin(v, (lo + hi) / 2)));

export const capDpr = (dpr: number) => clamp(fin(dpr, 1) || 1, 1, JOKER_DPR_CAP);

/** Drag delta (px) inside a canvas of w×h → clamped tilt in degrees. Reduced motion → no tilt. */
export function dragToTilt(base: JokerTilt, dx: number, dy: number, w: number, h: number, reduced = false): JokerTilt {
  if (reduced || !(w > 0) || !(h > 0)) return JOKER_REST;
  const m = JOKER_MAX_TILT_DEG;
  return {
    rx: clamp(fin(base.rx) + (fin(dy) / h) * m * 2.4, -m, m),
    ry: clamp(fin(base.ry) + (fin(dx) / w) * m * 2.4, -m, m),
  };
}

/** Frame-rate independent damping; reports settled so the loop can stop. */
export function stepTilt(cur: JokerTilt, target: JokerTilt, dtMs: number): { tilt: JokerTilt; settled: boolean } {
  const f = 1 - Math.exp(-clamp(dtMs, 0, 100) / 70);
  const rx = cur.rx + (target.rx - cur.rx) * f, ry = cur.ry + (target.ry - cur.ry) * f;
  const settled = Math.abs(rx - target.rx) < 0.01 && Math.abs(ry - target.ry) < 0.01;
  return { tilt: settled ? { ...target } : { rx, ry }, settled };
}

/** Camera distance so the card (incl. max tilt + margin) fits a viewport of given aspect. */
export function fitCameraDistance(aspect: number, fovDeg = 30, margin = 1.18): number {
  const a = clamp(aspect, 0.2, 5);
  const t = Math.tan(((clamp(fovDeg, 10, 90) * Math.PI) / 180) / 2);
  const tiltPad = 1 + Math.sin((JOKER_MAX_TILT_DEG * Math.PI) / 180) * 0.25;
  const hNeed = JOKER_CARD_H * margin * tiltPad, wNeed = JOKER_CARD_W * margin * tiltPad;
  return Math.max(hNeed / (2 * t), wNeed / (2 * t * a));
}

/** Render only when on-screen, tab visible, and something changed. */
export function shouldRender(s: { onScreen: boolean; docHidden: boolean; dirty: boolean }): boolean {
  return s.onScreen && !s.docHidden && s.dirty;
}

export type JokerSceneStatus = "loading" | "ready" | "unavailable";
export type JokerUnavailableReason = "unsupported" | "context-lost" | "texture" | "render";
export const JOKER_UNAVAILABLE_TEXT: Record<JokerUnavailableReason, string> = {
  unsupported: "3D unavailable: this browser can’t create a WebGL view.",
  "context-lost": "3D unavailable: the graphics view was lost.",
  texture: "3D unavailable: the card art couldn’t load into 3D.",
  render: "3D unavailable: the 3D view hit an error.",
};
