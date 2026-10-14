export function selectFeaturedRoom<T extends { headcount: number }>(
  rooms: readonly T[],
): T | undefined {
  let featured: T | undefined;
  for (const room of rooms) {
    if (room.headcount > 0 && (!featured || room.headcount > featured.headcount)) {
      featured = room;
    }
  }
  return featured;
}
