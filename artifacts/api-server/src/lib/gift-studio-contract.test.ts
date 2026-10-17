import assert from "node:assert/strict";
import test from "node:test";
import {
  AssignGiftStudioVersionToGiftBody,
  CreateGiftStudioVersionBody,
  GetActiveGiftStudioMediaResponse,
  GetRoomGiftEventsResponse,
  SaveGiftStudioProcessedBody,
  SetGiftStudioVersionActiveResponse,
} from "@workspace/api-zod";
import { mergeActiveGiftNames } from "./gift-studio-catalog";

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

test("active Gift Studio media contract carries its display name to animation players", () => {
  const parsed = GetActiveGiftStudioMediaResponse.safeParse({
    media: {
      versionId: "c1c0e6f4-a9af-4c09-9ce4-93b53ed6f118",
      name: "Midnight Roadster",
      webmUrl: "/api/social/gift-studio/media/c1c0e6f4-a9af-4c09-9ce4-93b53ed6f118/webm",
      safariUrl: "/api/social/gift-studio/media/c1c0e6f4-a9af-4c09-9ce4-93b53ed6f118/safari",
      durationMs: 5000,
    },
  });
  assert.equal(parsed.success, true);
});

test("active custom display names replace catalog labels without changing gift price", () => {
  const catalog = mergeActiveGiftNames(new Map([["whip", "Midnight Roadster"]]));
  const whip = catalog.find((gift) => gift.id === "whip");
  assert.equal(whip?.name, "Midnight Roadster");
  assert.equal(whip?.cost, 2500);
  assert.equal(catalog.find((gift) => gift.id === "rose-shower")?.name, "Rose Shower");
});

test("room gift notices expose the current catalog display name", () => {
  const parsed = GetRoomGiftEventsResponse.safeParse({
    events: [{
      id: "evt-1",
      giftId: "whip",
      giftName: "Midnight Roadster",
      senderUsername: "sender",
      recipientUsername: "recipient",
      senderName: "Sender",
      recipientName: "Recipient",
      senderBadgeId: null,
      recipientBadgeId: null,
      senderBadgeName: null,
      recipientBadgeName: null,
      senderBadgeImage: null,
      recipientBadgeImage: null,
      createdAt: new Date().toISOString(),
    }],
  });
  assert.equal(parsed.success, true);
});
