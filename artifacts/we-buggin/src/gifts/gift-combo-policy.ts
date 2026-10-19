export const MAX_COMBO_QUANTITY = 1314;
export const MINI_GIFT_DURATION_MS = 1000;
export const MAX_MINI_GIFTS_ON_SCREEN = 20;
export const REDUCED_MOTION_MINI_CAP = 8;

const TARGET_TOTALS: Array<[quantity: number, durationMs: number]> = [
  [1, 6000],
  [10, 10_000],
  [66, 15_000],
  [99, 18_000],
  [188, 25_000],
  [520, 40_000],
  [1314, 60_000],
];

export type GiftComboPlan = {
  quantity: number;
  fullDurationMs: number;
  miniDurationMs: number;
  miniLaunchOffsetsMs: number[];
  totalDurationMs: number;
  maxConcurrent: number;
  reducedMotion: boolean;
};

function targetDuration(quantity: number): number {
  if (quantity <= TARGET_TOTALS[0]![0]) return TARGET_TOTALS[0]![1];
  for (let i = 1; i < TARGET_TOTALS.length; i += 1) {
    const [upperQuantity, upperDuration] = TARGET_TOTALS[i]!;
    const [lowerQuantity, lowerDuration] = TARGET_TOTALS[i - 1]!;
    if (quantity <= upperQuantity) {
      const portion = (quantity - lowerQuantity) / (upperQuantity - lowerQuantity);
      return lowerDuration + (upperDuration - lowerDuration) * portion;
    }
  }
  return TARGET_TOTALS.at(-1)![1];
}

export function normalizeGiftQuantity(quantity: unknown): number {
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return 1;
  return Math.min(quantity, MAX_COMBO_QUANTITY);
}

export function buildGiftComboPlan(
  requestedQuantity: unknown,
  fullDurationMs = 6000,
  reducedMotion = false,
): GiftComboPlan {
  const quantity = normalizeGiftQuantity(requestedQuantity);
  const safeFullDuration = Math.max(500, Math.min(15_000, Math.round(fullDurationMs)));
  const miniDurationMs = reducedMotion ? 360 : MINI_GIFT_DURATION_MS;
  const maxConcurrent = reducedMotion ? REDUCED_MOTION_MINI_CAP : MAX_MINI_GIFTS_ON_SCREEN;
  if (quantity === 1) {
    return {
      quantity, fullDurationMs: safeFullDuration, miniDurationMs,
      miniLaunchOffsetsMs: [], totalDurationMs: safeFullDuration, maxConcurrent, reducedMotion,
    };
  }

  const minimumInterval = Math.ceil(miniDurationMs / maxConcurrent);
  const desiredSpacing = quantity === 2
    ? 0
    : (targetDuration(quantity) - safeFullDuration - miniDurationMs) / (quantity - 2);
  const interval = quantity === 2 ? 0 : Math.max(minimumInterval, desiredSpacing);
  const miniLaunchOffsetsMs = Array.from({ length: quantity - 1 }, (_, index) => index * interval);
  const lastLaunch = miniLaunchOffsetsMs.at(-1) ?? 0;
  return {
    quantity,
    fullDurationMs: safeFullDuration,
    miniDurationMs,
    miniLaunchOffsetsMs,
    totalDurationMs: safeFullDuration + lastLaunch + miniDurationMs,
    maxConcurrent,
    reducedMotion,
  };
}

export type IdentifiedGift<T> = T & { id: string };

export function appendUniqueGiftEvents<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const ids = new Set(current.map(item => item.id));
  const result = [...current];
  for (const item of incoming) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    result.push(item);
  }
  return result;
}

export function finishGiftQueueItem<T extends { id: string }>(queue: readonly T[], id: string): T[] {
  return queue[0]?.id === id ? queue.slice(1) : queue.filter(item => item.id !== id);
}

export function giftCounterAfterLaunch(current: number, launched: number, quantity: number): number {
  return Math.min(normalizeGiftQuantity(quantity), current + Math.max(0, Math.floor(launched)));
}

export function giftCounterAfterSkip(quantity: number): number {
  return normalizeGiftQuantity(quantity);
}
