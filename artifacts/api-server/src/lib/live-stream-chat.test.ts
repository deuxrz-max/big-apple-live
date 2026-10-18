import assert from "node:assert/strict";
import { test } from "node:test";
import { liveStreamChatHub } from "./live-stream-chat";

test("live stream chat keeps reportable messages and notifies connected viewers", () => {
  const streamId = "a".repeat(32);
  const received: Array<string | null> = [];
  const unsubscribe = liveStreamChatHub.subscribe(streamId, message => {
    received.push(message?.id ?? null);
  });
  const message = liveStreamChatHub.publish({
    streamId,
    accountId: "reporter-test",
    username: "TestUser",
    displayName: "Test User",
    displayNameColor: "#09B0EC",
    displayNameTierIndex: 3,
    badgeName: "Tier 1",
    badgeImage: "/badges/monthly-credit-tiers/tier1.svg",
    text: "A test chat message",
  });

  assert.equal(received.length, 1);
  assert.equal(received[0], message.id);
  assert.equal(liveStreamChatHub.find(streamId, message.id)?.text, "A test chat message");
  assert.equal(liveStreamChatHub.find(streamId, message.id)?.displayNameColor, "#09B0EC");
  assert.equal(liveStreamChatHub.find(streamId, message.id)?.badgeImage, "/badges/monthly-credit-tiers/tier1.svg");
  assert.equal(liveStreamChatHub.recent(streamId)[0]?.accountId, "reporter-test");
  liveStreamChatHub.end(streamId);
  assert.equal(received.at(-1), null);
  unsubscribe();
});

test("live stream chat history stays bounded", () => {
  const streamId = "b".repeat(32);
  for (let index = 0; index < 125; index++) {
    liveStreamChatHub.publish({
      streamId,
      accountId: "test-account",
      username: "TestUser",
      displayName: "Test User",
      displayNameColor: "#FFFFFF",
      displayNameTierIndex: 0,
      badgeName: null,
      badgeImage: null,
      text: `message ${index}`,
    });
  }
  const history = liveStreamChatHub.recent(streamId);
  assert.equal(history.length, 120);
  assert.equal(history[0]?.text, "message 5");
  liveStreamChatHub.end(streamId);
});

test("live stream gifts are retained briefly and delivered to viewers", () => {
  const streamId = "c".repeat(32);
  const received: Array<string | null> = [];
  const unsubscribe = liveStreamChatHub.subscribeGifts(streamId, gift => received.push(gift?.id ?? null));
  const gift = liveStreamChatHub.publishGift({
    streamId,
    senderAccountId: "test-sender",
    senderUsername: "TestSender",
    senderName: "Test Sender",
    senderNameColor: "#FFFFFF",
    senderNameTierIndex: 0,
    recipientUsername: "Creator",
    recipientName: "Creator",
    giftId: "heart",
    giftName: "Heart",
    cost: 50,
  });

  assert.equal(received[0], gift.id);
  assert.equal(liveStreamChatHub.recentGifts(streamId)[0]?.giftId, "heart");
  liveStreamChatHub.end(streamId);
  assert.equal(received.at(-1), null);
  unsubscribe();
});
