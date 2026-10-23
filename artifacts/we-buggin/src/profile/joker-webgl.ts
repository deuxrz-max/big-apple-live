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

/* ---------------- Gold foil finish (pure; shared by scene + tests) ---------------- */
export const JOKER_FACE_PX_W = 1000;
export const JOKER_FACE_PX_H = Math.round((JOKER_FACE_PX_W * JOKER_ART_H) / JOKER_ART_W); // 1422
export const JOKER_IDLE_PERIOD_MS = 7600;
export const JOKER_IDLE_FPS = 30;
export const JOKER_MARK_TEXT = "JOKER";

export type Rect = { x: number; y: number; w: number; h: number };
export type JokerFaceLayout = { frame: Rect; art: Rect; markTL: { x: number; y: number }; markBR: { x: number; y: number }; markSize: number };

/**
 * Face composite layout: the FULL source art is contained (aspect kept, never cropped) inside padding;
 * the new gold frame and corner marks sit entirely outside the art bounds.
 */
export function jokerFaceLayout(cw = JOKER_FACE_PX_W, ch = JOKER_FACE_PX_H): JokerFaceLayout {
  const padX = cw * 0.075, padY = ch * 0.078;
  const s = Math.min((cw - padX * 2) / JOKER_ART_W, (ch - padY * 2) / JOKER_ART_H);
  const w = JOKER_ART_W * s, h = JOKER_ART_H * s;
  const art = { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  const inset = cw * 0.03;
  const markSize = Math.round(cw * 0.034);
  return {
    frame: { x: inset, y: inset, w: cw - inset * 2, h: ch - inset * 2 },
    art,
    markTL: { x: inset + cw * 0.03, y: inset + markSize * 0.4 },
    markBR: { x: cw - inset - cw * 0.03, y: ch - inset - markSize * 0.4 },
    markSize,
  };
}

/** Idle band position 0..1 sweep (with off-card rest), gentle smoothstep, period ~7.6s. */
export function idleSweep(tMs: number, period = JOKER_IDLE_PERIOD_MS): number {
  const p = (((fin(tMs) % period) + period) % period) / period;
  const e = p * p * (3 - 2 * p);
  return -0.35 + e * 1.7;
}

export type FoilState = { pos: number; strength: number };
/** Band position along the card diagonal, tied to pointer UV, else tilt, else idle sweep. */
export function foilState(o: { pointer: { u: number; v: number } | null; tilt: JokerTilt; tMs: number; reduced: boolean }): FoilState {
  if (o.pointer) {
    const u = clamp(o.pointer.u, 0, 1), v = clamp(o.pointer.v, 0, 1);
    return { pos: (u + (1 - v)) / 2, strength: 1 };
  }
  const m = JOKER_MAX_TILT_DEG;
  const tiltPos = 0.5 + (fin(o.tilt.ry) / m) * 0.45 - (fin(o.tilt.rx) / m) * 0.3;
  const w = Math.min(1, Math.hypot(fin(o.tilt.rx), fin(o.tilt.ry)) / 3);
  if (o.reduced) return { pos: 0.32 + w * (tiltPos - 0.32), strength: 0.7 };
  const idle = idleSweep(o.tMs);
  // A released card can remain tilted. Keep the idle sweep alive in that
  // pose too, rather than locking the band wherever the last drag left it.
  return { pos: idle + (tiltPos - 0.5) * 0.2, strength: 0.78 + 0.22 * w };
}

/** Idle frames are throttled to ~30fps; interaction/easing draws every RAF. */
export function shouldDrawFrame(now: number, lastDraw: number, urgent: boolean, fps = JOKER_IDLE_FPS): boolean {
  return urgent || !lastDraw || now - lastDraw >= 1000 / fps - 2;
}

/** Loop continues while on-screen + visible and either animating idle (motion allowed) or easing. */
export function wantsLoop(s: { onScreen: boolean; docHidden: boolean; reduced: boolean; settled: boolean; dirty: boolean }): boolean {
  return s.onScreen && !s.docHidden && (!s.reduced || !s.settled || s.dirty);
}
