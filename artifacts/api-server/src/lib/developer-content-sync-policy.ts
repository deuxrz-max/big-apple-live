export type SyncItemResult<T> =
  | { value: T; error?: undefined }
  | { value?: undefined; error: string };

export type ContentProductType = "gift" | "entrance-effect";
export type CatalogSummaryItem = {
  id: string;
  productType: ContentProductType;
  status: string;
  animationAvailable: boolean;
};
export type StudioVersionSummaryItem = {
  id: string;
  giftId: string | null;
  status: string;
  settings: unknown;
};

const easternDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const easternTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function easternDateKey(date: Date): string {
  return easternDateFormatter.format(date);
}

export function easternMinuteOfDay(date: Date): number {
  const parts = easternTimeFormatter.formatToParts(date);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Catch up after 3 AM if the API process was asleep at the scheduled minute. */
export function isEasternDailySyncDue(date: Date, lastScheduledEasternDate: string | null): boolean {
  const today = easternDateKey(date);
  return easternMinuteOfDay(date) >= 3 * 60 && lastScheduledEasternDate !== today;
}

export function mergeUniqueRecordsByKey<T>(
  existing: readonly T[],
  incoming: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const item of existing) byKey.set(keyOf(item), item);
  for (const item of incoming) {
    if (!byKey.has(keyOf(item))) byKey.set(keyOf(item), item);
  }
  return [...byKey.values()];
}

export function studioVersionProductType(
  settings: unknown,
  giftId: string | null,
  catalogTypes: ReadonlyMap<string, ContentProductType>,
): ContentProductType {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const savedType = (settings as Record<string, unknown>).productType;
    if (savedType === "gift" || savedType === "entrance-effect") return savedType;
  }
  return (giftId && catalogTypes.get(giftId)) || "gift";
}

export function summarizeStudioContent(
  catalog: readonly CatalogSummaryItem[],
  versions: readonly StudioVersionSummaryItem[],
) {
  const uniqueCatalog = mergeUniqueRecordsByKey([], catalog, item => item.id);
  const uniqueVersions = mergeUniqueRecordsByKey([], versions, item => item.id);
  const catalogTypes = new Map(uniqueCatalog.map(item => [item.id, item.productType] as const));
  const countFor = (productType: ContentProductType) => {
    const items = uniqueCatalog.filter(item => item.productType === productType);
    return {
      active: items.filter(item => item.status === "active" && item.animationAvailable).length,
      drafts: uniqueVersions.filter(version => version.status === "draft"
        && studioVersionProductType(version.settings, version.giftId, catalogTypes) === productType).length,
      skipped: items.filter(item => item.status !== "active" || !item.animationAvailable).length,
    };
  };
  return {
    giftEffects: countFor("gift"),
    entranceEffects: countFor("entrance-effect"),
  };
}

export function comparePoolRecords<T extends { videoId: string }>(
  before: readonly T[],
  after: readonly T[],
): { added: number; updated: number } {
  const beforeById = new Map(before.map(item => [item.videoId, item]));
  let added = 0;
  let updated = 0;
  for (const item of after) {
    const previous = beforeById.get(item.videoId);
    if (!previous) added += 1;
    else if (JSON.stringify(previous) !== JSON.stringify(item)) updated += 1;
  }
  return { added, updated };
}

export async function runSyncItemsIndependently<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<Array<SyncItemResult<R>>> {
  const results: Array<SyncItemResult<R>> = [];
  for (const item of items) {
    try {
      results.push({ value: await run(item) });
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : "Unknown sync error",
      });
    }
  }
  return results;
}
