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
  screenCommunityVideoPoolItems,
  youtubeQuotaDateKey,
} from "./room-video-rotation";

const item = (videoId: string): CommunityVideoPoolItem & { availableInUS: boolean } => ({
  videoId,
  title: `Test title ${videoId}`,
  channelTitle: "Test channel",
  description: null,
  durationMs: 5 * 60_000,
  discoveredAtMs: Date.now(),
  availableInUS: true,
  defaultLanguage: "en",
  defaultAudioLanguage: "en",
  thumbnailAspectRatios: [16 / 9],
  embeddable: true,
});

test("YouTube quota date rolls over at midnight Pacific, including daylight time", () => {
  assert.equal(youtubeQuotaDateKey(new Date("2026-10-14T06:59:59.000Z")), "2026-10-13");
  assert.equal(youtubeQuotaDateKey(new Date("2026-10-14T07:00:00.000Z")), "2026-10-14");
  assert.equal(youtubeQuotaDateKey(new Date("2026-01-14T07:59:59.000Z")), "2026-01-13");
  assert.equal(youtubeQuotaDateKey(new Date("2026-01-14T08:00:00.000Z")), "2026-01-14");
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

test("saved pools remove unverified-language, short, marked-Shorts and square videos", () => {
  const safe = item("dQw4w9WgXcQ");
  const screened = screenCommunityVideoPoolItems([
    safe,
    {
      ...item("5qap5aO4i9A"),
      durationMs: 179_999,
    },
    {
      ...item("M7lc1UVf-VE"),
      description: "https://youtube.com/shorts/M7lc1UVf-VE",
    },
    {
      ...item("aqz-KE-bpKQ"),
      defaultLanguage: null,
      defaultAudioLanguage: null,
    },
    {
      ...item("ScMzIvxBSi4"),
      thumbnailAspectRatios: [1],
    },
  ]);
  assert.deepEqual(screened.videos.map(video => video.videoId), [safe.videoId]);
  assert.equal(screened.entriesRemoved, 4);
  assert.equal(screened.nonEnglishOrUnverifiedEntries, 1);
  assert.equal(screened.shortsOrUnderThreeMinuteEntries, 2);
  assert.equal(screened.nonWidescreenEntries, 1);
});

test("saved History and Pro Wrestling pools retain only their approved channel titles", () => {
  const history = screenCommunityVideoPoolItems([
    { ...item("HIST0000001"), channelTitle: "HISTORY" },
    { ...item("HIST0000002"), channelTitle: "HISTORY fan clips" },
  ], Date.now(), "HIST01");
  assert.deepEqual(history.videos.map(video => video.videoId), ["HIST0000001"]);
  assert.equal(history.untrustedSourceEntries, 1);

  const wrestling = screenCommunityVideoPoolItems([
    { ...item("WWE00000001"), channelTitle: "WWE" },
    { ...item("WWE00000002"), channelTitle: "WWE fan edits" },
  ], Date.now(), "KIDS01");
  assert.deepEqual(wrestling.videos.map(video => video.videoId), ["WWE00000001"]);
  assert.equal(wrestling.untrustedSourceEntries, 1);
});
