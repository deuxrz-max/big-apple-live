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
    text: "A test chat message",
  });

  assert.equal(received.length, 1);
  assert.equal(received[0], message.id);
  assert.equal(liveStreamChatHub.find(streamId, message.id)?.text, "A test chat message");
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
      text: `message ${index}`,
    });
  }
  const history = liveStreamChatHub.recent(streamId);
  assert.equal(history.length, 120);
  assert.equal(history[0]?.text, "message 5");
  liveStreamChatHub.end(streamId);
});
