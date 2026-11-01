import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db, pool, communityVideoPools } from "@workspace/db";
import { getCommunityVideoPool, initializeHarlemHashtagPool, refreshHarlemHashtagsIfDue } from "./room-video-rotation";
import { HARLEM_ROOM_ID, HARLEM_HASHTAGS } from "./harlem-video-policy";

test("development: populate Harlem through official hashtag search, preserve all other pools and reuse saved results", {
  skip: process.env.NODE_ENV !== "development",
}, async () => {
  const before = await db.select().from(communityVideoPools);
  await initializeHarlemHashtagPool();
  await refreshHarlemHashtagsIfDue(process.env.YOUTUBE_API_KEY?.trim() ?? "");
  const lookup = { communityParentId: (id: string) => id };
  const videos = await getCommunityVideoPool(HARLEM_ROOM_ID, "", lookup);
  assert.ok(videos.length > 0, "a real saved hashtag pool must exist");
  assert.equal(new Set(videos.map(video => video.videoId)).size, videos.length);
  const rows = await db.select().from(communityVideoPools);
  for (const row of before.filter(row => row.roomId !== HARLEM_ROOM_ID)) {
    assert.deepEqual(rows.find(other => other.roomId === row.roomId)?.videos, row.videos);
  }
  const row = rows.find(row => row.roomId === HARLEM_ROOM_ID)!;
  const provenance = JSON.parse(row.sourceCursors.__harlemHashtagSources ?? "{}") as Record<string, string[]>;
  console.log(JSON.stringify({
    total: videos.length,
    byHashtag: Object.fromEntries(HARLEM_HASHTAGS.map(tag => [tag,
      videos.filter(video => provenance[video.videoId]?.includes(tag)).length])),
    sample: videos.slice(0, 3).map(video => ({ title: video.title, creator: video.channelTitle })),
  }, null, 2));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Opening Harlem must not search YouTube"); };
  try {
    assert.deepEqual(await getCommunityVideoPool(HARLEM_ROOM_ID, "unused", lookup), videos);
    await refreshHarlemHashtagsIfDue("unused");
  } finally { globalThis.fetch = originalFetch; }
});
after(async () => { await pool.end(); });
