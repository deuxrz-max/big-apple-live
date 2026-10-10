export const MARATHON = { id: 'marathon-master', cost: 200, streakDays: 7, earnedDays: 7, boughtDays: 3 } as const;
export const NIGHT_OWL = { id: 'night-owl', cost: 1000, streakDays: 30, earnedDays: 30, boughtDays: 3 } as const;
export const TIMED_BADGES = [MARATHON, NIGHT_OWL] as const;
export type TimedBadgePolicy = typeof TIMED_BADGES[number];
const DAY_MS = 86_400_000;

export function nextLoginStreak(previous: { lastLoginDay: string; consecutiveDays: number } | undefined, now: Date) {
  const day = now.toISOString().slice(0, 10);
  if (previous && previous.lastLoginDay >= day)
    return { day: previous.lastLoginDay, count: previous.consecutiveDays, changed: false, award: false };
  const yesterday = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const count = previous?.lastLoginDay === yesterday ? previous.consecutiveDays + 1 : 1;
  return { day, count, changed: true, award: count % MARATHON.streakDays === 0 };
}

/** Extensions never consume remaining time; expired badges restart from now. */
export function extendMarathon(now: Date, currentExpiry: Date | null | undefined, days: number) {
  return new Date(Math.max(now.getTime(), currentExpiry?.getTime() ?? 0) + days * DAY_MS);
}
