/** Pure helpers for the owner-only premium card finish prototype. No DOM, no network. */
export const CARD_FINISH_MAX_TILT_DEG = 3;
export const CARD_FINISH_REST_SCALE = 0.955;
export const CARD_FINISH_ACTIVE_SCALE = 0.97;

export type CardFinishAccess = { owner?: boolean | null } | null | undefined;

/** Premium finish only for a server-confirmed owner in a development build. Fails closed. */
export function canUsePremiumCardFinish(isDev: boolean, access: CardFinishAccess): boolean {
  return isDev === true && access?.owner === true;
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);

export type CardFinishPose = { rx: number; ry: number; lx: number; ly: number; scale: number };
export const CARD_FINISH_REST: CardFinishPose = { rx: 0, ry: 0, lx: 50, ly: 30, scale: CARD_FINISH_REST_SCALE };

/** Map a pointer position inside a rect to a clamped tilt + light position. */
export function computeCardFinishPose(
  x: number, y: number, rect: { left: number; top: number; width: number; height: number },
  reducedMotion = false,
): CardFinishPose {
  if (!(rect.width > 0) || !(rect.height > 0)) return CARD_FINISH_REST;
  const nx = clamp((x - rect.left) / rect.width, 0, 1);
  const ny = clamp((y - rect.top) / rect.height, 0, 1);
  const lx = Math.round(nx * 1000) / 10, ly = Math.round(ny * 1000) / 10;
  if (reducedMotion) return { rx: 0, ry: 0, lx, ly, scale: CARD_FINISH_REST_SCALE };
  const m = CARD_FINISH_MAX_TILT_DEG;
  const ry = clamp((nx - 0.5) * 2 * m, -m, m);
  const rx = clamp((0.5 - ny) * 2 * m, -m, m);
  return { rx: Math.round(rx * 100) / 100, ry: Math.round(ry * 100) / 100, lx, ly, scale: CARD_FINISH_ACTIVE_SCALE };
}

/** Ease current pose toward target; returns whether it settled. */
export function stepCardFinishPose(cur: CardFinishPose, target: CardFinishPose, k = 0.22): { pose: CardFinishPose; settled: boolean } {
  const f = clamp(k, 0.01, 1);
  const n = (a: number, b: number) => a + (b - a) * f;
  const pose = { rx: n(cur.rx, target.rx), ry: n(cur.ry, target.ry), lx: n(cur.lx, target.lx), ly: n(cur.ly, target.ly), scale: n(cur.scale, target.scale) };
  const settled = Math.abs(pose.rx - target.rx) < 0.02 && Math.abs(pose.ry - target.ry) < 0.02
    && Math.abs(pose.lx - target.lx) < 0.2 && Math.abs(pose.ly - target.ly) < 0.2 && Math.abs(pose.scale - target.scale) < 0.0005;
  return { pose: settled ? target : pose, settled };
}
