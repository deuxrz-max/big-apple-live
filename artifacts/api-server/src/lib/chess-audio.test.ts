import test from "node:test";
import assert from "node:assert/strict";
import { TrackSource } from "livekit-server-sdk";
import { LiveKitBeamService } from "./livekit";

test("Chess token is room-scoped, short lived and permits only microphone audio", async () => {
  const service = new LiveKitBeamService(() => ({
    url: "wss://chess-test.invalid", apiKey: "chess-test-key", apiSecret: "isolated-test-signing-key-not-a-real-credential",
  }));
  const { token, url } = await service.createChessToken({
    roomName: "chess-isolated-test", participantId: "test-player", displayName: "Test Player",
  });
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
  assert.equal(url, "wss://chess-test.invalid");
  assert.equal(payload.sub, "test-player");
  assert.equal(payload.video.room, "chess-isolated-test");
  assert.equal(payload.video.canSubscribe, true);
  assert.equal(payload.video.canPublishData, false);
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  assert.equal(payload.exp - payload.nbf, 300);
  assert.notEqual(TrackSource.MICROPHONE, TrackSource.CAMERA);
});
