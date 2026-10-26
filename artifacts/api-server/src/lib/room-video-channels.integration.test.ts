import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db, pool, communityVideoPools, communityWebSeriesDaily } from "@workspace/db";
import { getCommunityPlaybackSchedule, getCommunityVideoPool } from "./room-video-rotation";
import { UNIFIED_VIDEO_CHANNELS } from "./room-video-channels";

test("development: each combined channel contains all of its existing sources and no unrelated videos", {
  skip: process.env.NODE_ENV !== "development",
}, async () => {
  const before = await db.select().from(communityVideoPools);
  const series = await db.select().from(communityWebSeriesDaily);
  const lookup = { communityParentId: (id: string) => id };
  for (const channel of UNIFIED_VIDEO_CHANNELS) {
    const expected = new Set<string>();
    for (const sourceId of channel.sourceRoomIds) {
      const row = before.find(item => item.roomId === sourceId);
      for (const video of row?.videos ?? []) if (video.availableInUS === true) expected.add(video.videoId);
      if (sourceId === "NEWS01") {
        for (const video of (await getCommunityPlaybackSchedule(sourceId))?.queue ?? []) expected.add(video.videoId);
      }
      if (sourceId === "WEBSER") {
        for (const selection of series.filter(item => item.roomId === sourceId))
          for (const video of selection.episodes ?? []) if (video.availableInUS === true) expected.add(video.videoId);
      }
    }
    const videos = await getCommunityVideoPool(channel.roomId, "", lookup);
    assert.ok(videos.length > 0, `${channel.label} has existing playable content`);
    assert.deepEqual([...new Set(videos.map(video => video.videoId))].sort(), [...expected].sort());
    assert.equal(videos.length, expected.size, "no duplicates or 50-video catalog truncation");
    console.log(`${channel.label}: ${videos.length} combined existing videos`);
  }
  const afterRows = await db.select().from(communityVideoPools);
  // Playback schedulers may update cursor/time metadata independently; source video arrays must not change.
  for (const row of before) assert.deepEqual(afterRows.find(item => item.roomId === row.roomId)?.videos, row.videos);
});
after(async () => { await pool.end(); });
