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
    quantity: 1,
  });

  assert.equal(received[0], gift.id);
  assert.equal(liveStreamChatHub.recentGifts(streamId)[0]?.giftId, "heart");
  liveStreamChatHub.end(streamId);
  assert.equal(received.at(-1), null);
  unsubscribe();
});

test("live stream hearts and shares are counted separately and broadcast to connected viewers", () => {
  const streamId = "e".repeat(32);
  liveStreamChatHub.start(streamId);
  const received: Array<{ hearts: number; shares: number } | null> = [];
  const unsubscribe = liveStreamChatHub.subscribeEngagement(streamId, engagement => received.push(engagement));

  assert.deepEqual(liveStreamChatHub.recordEngagement(streamId, "viewer-one", "heart"), { hearts: 1, shares: 0 });
  assert.deepEqual(liveStreamChatHub.recordEngagement(streamId, "viewer-two", "share"), { hearts: 1, shares: 1 });
  assert.deepEqual(received, [{ hearts: 1, shares: 0 }, { hearts: 1, shares: 1 }]);
  assert.deepEqual(liveStreamChatHub.currentEngagement(streamId), { hearts: 1, shares: 1 });

  liveStreamChatHub.end(streamId);
  assert.equal(received.at(-1), null);
  unsubscribe();
});

test("engagement totals reset when a new live stream session starts", () => {
  const streamId = "f".repeat(32);
  liveStreamChatHub.start(streamId);
  liveStreamChatHub.recordEngagement(streamId, "viewer-one", "heart");
  liveStreamChatHub.end(streamId);

  liveStreamChatHub.start(streamId);
  assert.deepEqual(liveStreamChatHub.currentEngagement(streamId), { hearts: 0, shares: 0 });
  liveStreamChatHub.end(streamId);
});

test("a large gift queue retains ordered, quantity-bearing events for all live viewers", () => {
  const streamId = "d".repeat(32);
  const receivedByOne: string[] = [];
  const receivedByTwo: string[] = [];
  liveStreamChatHub.subscribeGifts(streamId, gift => {
    if (gift) receivedByOne.push(`${gift.senderUsername}:${gift.quantity}`);
  });
  liveStreamChatHub.subscribeGifts(streamId, gift => {
    if (gift) receivedByTwo.push(`${gift.senderUsername}:${gift.quantity}`);
  });
  const sent: string[] = [];
  for (let index = 0; index < 150; index += 1) {
    const senderUsername = `sender-${index % 2}`;
    sent.push(`${senderUsername}:${index + 1}`);
    liveStreamChatHub.publishGift({
      streamId,
      senderAccountId: `account-${index % 2}`,
      senderUsername,
      senderName: senderUsername,
      senderNameColor: "#FFFFFF",
      senderNameTierIndex: 0,
      recipientUsername: "Creator",
      recipientName: "Creator",
      giftId: "heart",
      giftName: "Heart",
      cost: (index + 1) * 50,
      quantity: index + 1,
    });
  }
  assert.deepEqual(receivedByOne, sent);
  assert.deepEqual(receivedByTwo, sent);
  assert.deepEqual(liveStreamChatHub.recentGifts(streamId).map(gift => `${gift.senderUsername}:${gift.quantity}`), sent);
  liveStreamChatHub.end(streamId);
});
