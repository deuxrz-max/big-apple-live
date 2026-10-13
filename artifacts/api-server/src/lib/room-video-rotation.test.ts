import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import {
  communityVideoPlayHistory,
  communityVideoPools,
  db,
  type CommunityVideoPoolItem,
} from "@workspace/db";
import {
  chooseUnplayedVideo,
  getNextCommunityVideoSelection,
  recordCommunityVideoPlayed,
} from "./room-video-rotation";

const item = (videoId: string): CommunityVideoPoolItem => ({
  videoId,
  title: `Test title ${videoId}`,
  channelTitle: "Test channel",
  description: null,
  durationMs: 5 * 60_000,
  discoveredAtMs: Date.now(),
});

test("room rotation avoids recently played items, then permits a repeat after the pool is exhausted", () => {
  const now = Date.now();
  const pool = [item("aaa11111111"), item("bbb22222222"), item("ccc33333333")];
  const played = new Map([
    [pool[0]!.videoId, now - 60_000],
    [pool[1]!.videoId, now - 60_000],
  ]);
  assert.equal(chooseUnplayedVideo(pool, played, now, () => 0)?.videoId, pool[2]!.videoId);

  played.set(pool[2]!.videoId, now - 60_000);
  assert.equal(
    chooseUnplayedVideo(pool, played, now, () => 2)?.videoId,
    pool[2]!.videoId,
    "when the whole pool has played recently, an item may repeat",
  );
  assert.equal(
    chooseUnplayedVideo(pool, new Map([[pool[0]!.videoId, now - 25 * 60 * 60_000]]), now, () => 0)?.videoId,
    pool[0]!.videoId,
    "an item becomes eligible again after 24 hours",
  );
});

test("a played-video marker survives a fresh pool read and prevents an immediate repeat", async () => {
  const roomId = `ROTATE${randomUUID().replaceAll("-", "").slice(0, 8)}`.toUpperCase();
  const videos = [item("ddd44444444"), item("eee55555555")];
  try {
    await db.insert(communityVideoPools).values({
      roomId,
      videos,
      refreshedAt: new Date(),
      lastAttemptAt: new Date(),
    });
    const first = await getNextCommunityVideoSelection(roomId, "not-used", { communityParentId: () => null });
    assert.ok(first.selected);
    await recordCommunityVideoPlayed(roomId, first.selected.videoId);

    const afterReload = await getNextCommunityVideoSelection(roomId, "not-used", { communityParentId: () => null });
    assert.ok(afterReload.selected);
    assert.notEqual(afterReload.selected.videoId, first.selected.videoId);
    assert.equal(afterReload.queue[0]?.videoId, afterReload.selected.videoId);
  } finally {
    await db.delete(communityVideoPlayHistory)
      .where(eq(communityVideoPlayHistory.roomId, roomId));
    await db.delete(communityVideoPools)
      .where(eq(communityVideoPools.roomId, roomId));
  }
});
