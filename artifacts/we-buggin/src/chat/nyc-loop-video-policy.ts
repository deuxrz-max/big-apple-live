export const NYC_LOOP_CROSSFADE_MS = 420;
export const NYC_LOOP_START_WINDOW_SECONDS = 0.9;
export const NYC_LOOP_PRELOAD_WINDOW_SECONDS = 2.25;
const HAVE_CURRENT_DATA = 2;

export function shouldStartNycLoopCrossfade(remainingSeconds: number, readyState: number): boolean {
  return Number.isFinite(remainingSeconds)
    && remainingSeconds >= 0
    && remainingSeconds <= NYC_LOOP_START_WINDOW_SECONDS
    && readyState >= HAVE_CURRENT_DATA;
}

export function shouldPreloadNycLoopStandby(remainingSeconds: number): boolean {
  return Number.isFinite(remainingSeconds)
    && remainingSeconds >= 0
    && remainingSeconds <= NYC_LOOP_PRELOAD_WINDOW_SECONDS;
}
