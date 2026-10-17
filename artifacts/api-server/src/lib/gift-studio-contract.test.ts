import assert from "node:assert/strict";
import test from "node:test";
import {
  AssignGiftStudioVersionToGiftBody,
  CreateGiftStudioVersionBody,
  SaveGiftStudioProcessedBody,
  SetGiftStudioVersionActiveResponse,
} from "@workspace/api-zod";

test("Gift Studio accepts an explicitly unassigned named draft", () => {
  const parsed = CreateGiftStudioVersionBody.safeParse({
    settings: JSON.stringify({ draftName: "Rose Shower Test" }),
    sourceVideo: "source.mp4",
    processedWebm: "transparent.webm",
  });
  assert.equal(parsed.success, true);
});

test("Gift Studio still accepts a draft targeted to an existing catalog gift", () => {
  const parsed = CreateGiftStudioVersionBody.safeParse({
    giftId: "rose-shower",
    settings: JSON.stringify({ draftName: "Rose Shower Test" }),
    sourceVideo: "source.mp4",
    processedWebm: "transparent.webm",
  });
  assert.equal(parsed.success, true);
});

test("only a catalog gift can be selected when attaching a standalone draft", () => {
  assert.equal(AssignGiftStudioVersionToGiftBody.safeParse({ giftId: "whip" }).success, true);
  assert.equal(AssignGiftStudioVersionToGiftBody.safeParse({ giftId: "new-gift" }).success, false);
});

test("a processed server-side session can save either a standalone draft or an existing gift draft", () => {
  const base = { processingSession: "c1c0e6f4-a9af-4c09-9ce4-93b53ed6f118", draftName: "Night Bloom" };
  assert.equal(SaveGiftStudioProcessedBody.safeParse(base).success, true);
  assert.equal(SaveGiftStudioProcessedBody.safeParse({ ...base, giftId: "rose-shower" }).success, true);
  assert.equal(SaveGiftStudioProcessedBody.safeParse({ ...base, giftId: "new-gift" }).success, false);
});

test("a saved standalone draft is represented without pretending it belongs to Heart", () => {
  const parsed = SetGiftStudioVersionActiveResponse.safeParse({
    id: "c1c0e6f4-a9af-4c09-9ce4-93b53ed6f118",
    giftId: null,
    version: 1,
    status: "draft",
    originalName: "source.mp4",
    durationMs: 4000,
    settings: { preset: "green", keyColor: "#00ff00", tolerance: 0.24, softness: 0.08, spill: 0.35, maxDimension: 720, draftName: "Rose Shower Test" },
    createdAt: new Date(),
    originalUrl: "/original",
    webmUrl: "/webm",
    safariUrl: "/safari",
    originalBytes: 200,
    webmBytes: 200,
    safariBytes: 300,
  });
  assert.equal(parsed.success, true);
});
