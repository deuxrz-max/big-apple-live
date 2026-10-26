/** Rendering only: callers must supply authoritative progress; absent progress stays empty. */
export function cauldronDisplayLevel(progressPercent?: number | null): number {
  return typeof progressPercent === 'number' && Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, Math.round(progressPercent))) : 0;
}
