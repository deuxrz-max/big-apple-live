export function selectFeaturedRoom<T extends { headcount: number; headcountSince?: number }>(
  rooms: readonly T[],
): T | undefined {
  let featured: T | undefined;
  for (const room of rooms) {
    if (room.headcount <= 0) continue;
    const roomReachedCountAt = Number.isFinite(room.headcountSince) ? room.headcountSince! : Number.POSITIVE_INFINITY;
    const featuredReachedCountAt = featured && Number.isFinite(featured.headcountSince)
      ? featured.headcountSince!
      : Number.POSITIVE_INFINITY;
    if (!featured || room.headcount > featured.headcount
      || (room.headcount === featured.headcount && roomReachedCountAt < featuredReachedCountAt)) {
      featured = room;
    }
  }
  return featured;
}
