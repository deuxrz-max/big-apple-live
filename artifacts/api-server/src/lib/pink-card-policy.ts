import { easternHangoutDayKey } from "./community-hangout-policy";

export const WIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DRAW_COUNT = 6;
export const rewardCycleKey = easternHangoutDayKey;

/** Find local 03:00 without assuming a fixed UTC offset, including DST days. */
export function rewardCycleBounds(at: Date): { cycle: string; start: Date; end: Date } {
  const cycle = rewardCycleKey(at);
  const anchor = new Date(`${cycle}T12:00:00Z`).getTime();
  const findStart = (key: string, base: number) => {
    for (let hour = -12; hour <= 12; hour++) {
      const candidate = new Date(base + hour * 3_600_000);
      if (rewardCycleKey(candidate) === key && rewardCycleKey(new Date(candidate.getTime() - 1)) !== key)
        return candidate;
    }
    throw new Error("Cannot resolve Eastern daily reset");
  };
  const nextKey = new Date(anchor + 86_400_000).toISOString().slice(0, 10);
  return { cycle, start: findStart(cycle, anchor), end: findStart(nextKey, anchor + 86_400_000) };
}

/** One unpredictable instant in each sixth of the cycle; never expose future times. */
export function rewardDrawTimes(start: Date, end: Date, integer: (max: number) => number): Date[] {
  const length = end.getTime() - start.getTime();
  return Array.from({ length: DRAW_COUNT }, (_, slot) => {
    const lo = Math.floor(length * slot / DRAW_COUNT);
    const hi = Math.floor(length * (slot + 1) / DRAW_COUNT);
    return new Date(start.getTime() + lo + integer(hi - lo));
  });
}

export function eligibleAfterWin(lastWin: Date | null, now: Date): boolean {
  return !lastWin || now.getTime() - lastWin.getTime() >= WIN_COOLDOWN_MS;
}
