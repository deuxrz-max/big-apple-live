import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePoolRecords,
  easternDateKey,
  easternMinuteOfDay,
  isEasternDailySyncDue,
  mergeUniqueRecordsByKey,
  runSyncItemsIndependently,
  summarizeStudioContent,
} from "./developer-content-sync-policy";

test("the schedule follows 3 AM Eastern in both standard and daylight time", () => {
  const winterAtThree = new Date("2026-01-19T08:00:00.000Z");
  const summerAtThree = new Date("2026-07-19T07:00:00.000Z");
  assert.equal(easternDateKey(winterAtThree), "2026-01-19");
  assert.equal(easternMinuteOfDay(winterAtThree), 180);
  assert.equal(easternMinuteOfDay(summerAtThree), 180);
  assert.equal(isEasternDailySyncDue(winterAtThree, "2026-01-18"), true);
  assert.equal(isEasternDailySyncDue(winterAtThree, "2026-01-19"), false);
  assert.equal(isEasternDailySyncDue(new Date("2026-01-19T07:59:00.000Z"), "2026-01-18"), false);
});

test("sync merges are idempotent and report only actual pool additions or changes", () => {
  const initial = [{ videoId: "video-1", title: "First" }];
  const withNewVideo = mergeUniqueRecordsByKey(initial, [
    { videoId: "video-1", title: "Do not overwrite saved metadata" },
    { videoId: "video-2", title: "Second" },
  ], item => item.videoId);
  assert.equal(withNewVideo.length, 2);
  assert.deepEqual(comparePoolRecords(initial, withNewVideo), { added: 1, updated: 0 });
  const secondPass = mergeUniqueRecordsByKey(withNewVideo, [
    { videoId: "video-1", title: "First" },
    { videoId: "video-2", title: "Second" },
  ], item => item.videoId);
  assert.equal(secondPass.length, 2);
  assert.deepEqual(comparePoolRecords(withNewVideo, secondPass), { added: 0, updated: 0 });
  assert.deepEqual(comparePoolRecords(initial, [
    { videoId: "video-1", title: "Updated title" },
  ]), { added: 0, updated: 1 });
});

test("one broken sync item is skipped without stopping later items", async () => {
  const results = await runSyncItemsIndependently(["Music", "Movies", "History"], async room => {
    if (room === "Movies") throw new Error("YouTube quota unavailable");
    return `${room} refreshed`;
  });
  assert.deepEqual(results, [
    { value: "Music refreshed" },
    { error: "YouTube quota unavailable" },
    { value: "History refreshed" },
  ]);
});

test("new Gift Studio drafts appear in the right summary without duplicate counts", () => {
  const catalog = [
    { id: "rose", productType: "gift" as const, status: "active", animationAvailable: true },
    { id: "whip", productType: "entrance-effect" as const, status: "active", animationAvailable: true },
    { id: "retired", productType: "gift" as const, status: "inactive", animationAvailable: true },
  ];
  const versions = [
    { id: "v-new-gift", giftId: "new-gift", status: "draft", settings: { productType: "gift" } },
    { id: "v-new-entry", giftId: "new-entry", status: "draft", settings: { productType: "entrance-effect" } },
    { id: "v-new-entry", giftId: "new-entry", status: "draft", settings: { productType: "entrance-effect" } },
  ];
  const expected = {
    giftEffects: { active: 1, drafts: 1, skipped: 1 },
    entranceEffects: { active: 1, drafts: 1, skipped: 0 },
  };
  assert.deepEqual(summarizeStudioContent(catalog, versions), expected);
  assert.deepEqual(summarizeStudioContent(catalog, versions), expected);
});
