export const HANGOUT_DAY_TIME_ZONE = "America/New_York";
export const HANGOUT_DAY_START_HOUR = 3;
export const HANGOUT_ROOM_DWELL_MS = 60_000;
export const HANGOUT_SEAT_QUALIFY_MS = 15 * 60_000;
export const HANGOUT_STREAK_REWARD = 100;

export type HangoutStreakState = {
  lastQualifiedDay: string;
  consecutiveDays: number;
  lastRewardDay: string | null;
};

function dayKeyParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Hangout day must be YYYY-MM-DD");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function previousHangoutDay(dayKey: string): string {
  const { year, month, day } = dayKeyParts(dayKey);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/** Returns the New York calendar date whose day started at 3:00 AM Eastern. */
export function easternHangoutDayKey(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HANGOUT_DAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = Number(read("hour"));
  const calendarDay = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return hour < HANGOUT_DAY_START_HOUR ? previousHangoutDay(calendarDay) : calendarDay;
}

export function nextHangoutStreakState(
  previous: HangoutStreakState | null,
  dayKey: string,
): { state: HangoutStreakState; rewardedNow: boolean } {
  if (previous?.lastQualifiedDay === dayKey) return { state: previous, rewardedNow: false };

  const isConsecutive = previous?.lastQualifiedDay === previousHangoutDay(dayKey);
  const newCycleAfterReward = isConsecutive
    && previous?.consecutiveDays === 7
    && previous.lastRewardDay === previous.lastQualifiedDay;
  const consecutiveDays = isConsecutive && !newCycleAfterReward
    ? Math.min(7, (previous?.consecutiveDays ?? 0) + 1)
    : 1;
  const rewardedNow = consecutiveDays === 7 && previous?.lastRewardDay !== dayKey;
  return {
    state: {
      lastQualifiedDay: dayKey,
      consecutiveDays,
      lastRewardDay: rewardedNow ? dayKey : previous?.lastRewardDay ?? null,
    },
    rewardedNow,
  };
}

export function displayHangoutStreakDays(
  state: HangoutStreakState | null,
  today: string,
): number {
  if (!state) return 0;
  if (state.lastQualifiedDay === today) return state.consecutiveDays;
  if (state.lastQualifiedDay === previousHangoutDay(today)) {
    if (state.consecutiveDays === 7 && state.lastRewardDay === state.lastQualifiedDay) return 0;
    return state.consecutiveDays;
  }
  return 0;
}

export function isSeatQualified(seatedSinceMs: number, nowMs: number, minimumMs = HANGOUT_SEAT_QUALIFY_MS): boolean {
  return nowMs - seatedSinceMs >= minimumMs;
}

/** An in-room seat move preserves tenure; leaving the room clears the stored timestamp. */
export function seatSinceAfterJoin(existingRoomId: string | null, existingSince: number | null, roomId: string, now: number): number {
  return existingRoomId?.toUpperCase() === roomId.toUpperCase() && existingSince !== null
    ? existingSince
    : now;
}

function randomIndex(random: () => number, length: number): number {
  if (length <= 1) return 0;
  return Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999999999, random())) * length));
}

/** Selects one or two distinct occupied rooms, never all public rooms. */
export function chooseCoinDropRooms<T>(
  eligibleRoomIds: readonly T[],
  publicRoomCount: number,
  random: () => number = Math.random,
): T[] {
  const countLimit = Math.min(2, eligibleRoomIds.length, Math.max(0, publicRoomCount - 1));
  if (countLimit < 1) return [];
  const targetCount = countLimit === 1 ? 1 : random() < 0.5 ? 1 : 2;
  const shuffled = [...eligibleRoomIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomIndex(random, index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled.slice(0, targetCount);
}

/** Uniform selection when the injected random function is uniform on [0, 1). */
export function coinDropAmount(random: () => number = Math.random): number {
  return randomIndex(random, 100) + 1;
}

export function randomizedDropDelayMs(averageMinutes: number, random: () => number = Math.random): number {
  const factor = 0.5 + Math.max(0, Math.min(0.999999999999, random()));
  return Math.round(averageMinutes * 60_000 * factor);
}
