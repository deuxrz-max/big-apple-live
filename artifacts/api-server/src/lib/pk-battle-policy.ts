import { rewardCycleBounds } from "./pink-card-policy";

export const PK_SEARCH_TIMEOUT_MS = 60_000;
export const PK_COUNTDOWN_MS = 3_000;
export const PK_BATTLE_LENGTH_MS = 5 * 60_000;
export const PK_BONUS_START_MS = 2 * 60_000;
export const PK_BONUS_END_MS = 3 * 60_000;
export const PK_RESULT_VISIBLE_MS = 8_000;

export function pkPointsForGift(coins: number, elapsedMs: number): number {
  return coins * (elapsedMs >= PK_BONUS_START_MS && elapsedMs < PK_BONUS_END_MS ? 2 : 1);
}

/** Monday's existing 3 AM Eastern reset, including EST/EDT changes. */
export function pkWeeklyReset(at: Date): Date {
  const cycle = rewardCycleBounds(at).cycle;
  const [year, month, day] = cycle.split("-").map(Number);
  const utcCycle = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const daysSinceMonday = (utcCycle.getUTCDay() + 6) % 7;
  utcCycle.setUTCDate(utcCycle.getUTCDate() - daysSinceMonday);
  const mondayCycle = utcCycle.toISOString().slice(0, 10);
  return rewardCycleBounds(new Date(`${mondayCycle}T12:00:00Z`)).start;
}

export function battleWinner(scoreA: number, scoreB: number, accountA: string, accountB: string): string | null {
  return scoreA === scoreB ? null : scoreA > scoreB ? accountA : accountB;
}
