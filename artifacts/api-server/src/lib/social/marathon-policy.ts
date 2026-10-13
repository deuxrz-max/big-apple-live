const DAY_MS = 86_400_000;

export function nextLoginStreak(previous: { lastLoginDay: string; consecutiveDays: number } | undefined, now: Date) {
  const day = now.toISOString().slice(0, 10);
  if (previous && previous.lastLoginDay >= day)
    return { day: previous.lastLoginDay, count: previous.consecutiveDays, changed: false };
  const yesterday = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const count = previous?.lastLoginDay === yesterday ? previous.consecutiveDays + 1 : 1;
  return { day, count, changed: true };
}
