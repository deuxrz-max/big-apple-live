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
  isComedyWeeklyRefreshDue,
  isDirectoryCommunityPoolRoom,
  recordCommunityVideoPlayed,
  screenCommunityVideoPoolItems,
  youtubeQuotaDateKey,
} from "./room-video-rotation";
import { isOfficialMusicVideo } from "./music-video-policy";
import {
  communityVideoSearchPolicy,
  communityVideoSearchTerms,
  communityVideoUploadChannels,
} from "./community-config";
import { isCompleteFeatureFilm, MIN_FEATURE_FILM_DURATION_MS } from "./movies-video-policy";

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

test("Comedy's saved-pool refresh becomes due once per seven-day interval", () => {
  const monday = Date.parse("2026-10-19T12:00:00.000Z");
  assert.equal(isComedyWeeklyRefreshDue(null, monday), true);
  assert.equal(isComedyWeeklyRefreshDue(monday, monday + 7 * 24 * 60 * 60_000 - 1), false);
  assert.equal(isComedyWeeklyRefreshDue(monday, monday + 7 * 24 * 60 * 60_000), true);
});

test("saved-pool maintenance is limited to visible rooms and their overflow children", () => {
  const rooms = { communityParentId: (roomId: string) => roomId === "MUSIC12" ? "MUSIC1" : roomId };
  assert.equal(isDirectoryCommunityPoolRoom("MUSIC1", rooms), true);
  assert.equal(isDirectoryCommunityPoolRoom("MUSIC12", rooms), true);
  assert.equal(isDirectoryCommunityPoolRoom("GAMING", rooms), false);
  assert.equal(isDirectoryCommunityPoolRoom("WORLDNEWS", rooms), false);
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

test("Comedy pools retain only tagged configured sources", () => {
  const comedy = screenCommunityVideoPoolItems([
    { ...item("JKD00000001"), channelTitle: "JkDAnimator", sourceTag: "jkdanimator" },
    { ...item("CCN00000001"), channelTitle: "Comedy Central", sourceTag: "comedycentral" },
    { ...item("PLAY0000001"), channelTitle: "Various playlist creators", sourceTag: "playlist" },
    { ...item("RANDO000001"), channelTitle: "Random comedy reupload" },
  ], Date.now(), "COMEDY");
  assert.deepEqual(comedy.videos.map(video => video.videoId), [
    "JKD00000001", "CCN00000001", "PLAY0000001",
  ]);
  assert.equal(comedy.untrustedSourceEntries, 1);
});

test("Music keeps only English Music-category official artist videos and VEVO uploads", () => {
  const screened = screenCommunityVideoPoolItems([
    {
      ...item("MUSIC000001"),
      title: "Artist One - Night Drive (Official Music Video)",
      channelTitle: "Artist One",
      categoryId: "10",
    },
    {
      ...item("MUSIC000002"),
      title: "Artist Two - Blue Hour (Official Video)",
      channelTitle: "ArtistTwoVEVO",
      categoryId: "10",
    },
    {
      ...item("MUSIC000003"),
      title: "Artist One - Night Drive (Official Music Video)",
      channelTitle: "Fan Uploads",
      categoryId: "10",
    },
    {
      ...item("MUSIC000004"),
      title: "Artist One - Night Drive (Official Music Video)",
      channelTitle: "Artist One",
      categoryId: "10",
      description: "Lyrics and reaction podcast",
    },
    {
      ...item("MUSIC000005"),
      title: "Artist One - Night Drive (Official Music Video)",
      channelTitle: "Artist One",
      categoryId: "20",
    },
    {
      ...item("MUSIC000006"),
      title: "Artist One - Night Drive (Lyric Video)",
      channelTitle: "Artist One",
      categoryId: "10",
    },
  ], Date.now(), "MUSIC1");

  assert.deepEqual(screened.videos.map(video => video.videoId), ["MUSIC000001", "MUSIC000002"]);
  assert.equal(screened.entriesRemoved, 4);
});

test("official Music video predicate rejects uploads without Music category or artist provenance", () => {
  assert.equal(isOfficialMusicVideo({
    title: "Artist - Track (Official Music Video)",
    channelTitle: "Artist",
    categoryId: "10",
  }), true);
  assert.equal(isOfficialMusicVideo({
    title: "Artist - Track (Official Music Video)",
    channelTitle: "Fan Channel",
    categoryId: "10",
  }), false);
  assert.equal(isOfficialMusicVideo({
    title: "Artist - Track (Official Music Video)",
    channelTitle: "Artist",
    categoryId: "20",
  }), false);
});

test("Music searches use YouTube's Music category and official-video-only query terms", () => {
  assert.equal(communityVideoSearchPolicy("MUSIC1")?.videoCategoryId, "10");
  const terms = communityVideoSearchTerms("MUSIC1");
  assert.ok(terms.every(term => /official/i.test(term)));
  assert.ok(terms.every(term => !/\b(?:live|performance|concert|reaction|cover|lyrics?)\b/i.test(term)));
});

test("Movies retains only 60-minute full films from the approved distributor channels", () => {
  const screened = screenCommunityVideoPoolItems([
    {
      ...item("MOVIE000001"),
      title: "The Feature (Full Movie)",
      channelTitle: "FilmRise Movies",
      durationMs: MIN_FEATURE_FILM_DURATION_MS + 1,
    },
    {
      ...item("MOVIE000002"),
      title: "The Feature (Full Movie)",
      channelTitle: "FilmRise Movies",
      durationMs: MIN_FEATURE_FILM_DURATION_MS - 1,
    },
    {
      ...item("MOVIE000003"),
      title: "The Feature (Full Movie Trailer)",
      channelTitle: "Lionsgate Movies",
      durationMs: 90 * 60_000,
    },
    {
      ...item("MOVIE000004"),
      title: "The Feature Explained (Full Movie)",
      channelTitle: "Popcornflix",
      durationMs: 90 * 60_000,
    },
    {
      ...item("MOVIE000005"),
      title: "The Feature (Full Movie)",
      channelTitle: "Random Reuploads",
      durationMs: 90 * 60_000,
    },
  ], Date.now(), "MOVIES");

  assert.deepEqual(screened.videos.map(video => video.videoId), ["MOVIE000001"]);
  assert.equal(screened.entriesRemoved, 4);
});

test("Movies searches and channel uploads stay limited to complete-film sources", () => {
  const policy = communityVideoSearchPolicy("MOVIES");
  const channels = communityVideoUploadChannels("MOVIES");
  const terms = communityVideoSearchTerms("MOVIES");
  assert.deepEqual(policy?.trustedChannelTitles, channels.map(channel => channel.channelTitle));
  assert.equal(channels.length, 5);
  assert.ok(terms.every(term => /full movie/i.test(term)));
  assert.equal(isCompleteFeatureFilm({
    title: "A Complete Feature Film",
    durationMs: MIN_FEATURE_FILM_DURATION_MS,
  }), true);
});
