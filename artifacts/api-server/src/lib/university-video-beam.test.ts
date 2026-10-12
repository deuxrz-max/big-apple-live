import { test } from "node:test";
import assert from "node:assert/strict";
import type { EmojiIdentity } from "@workspace/api-zod";
import { RoomError, RoomStore } from "./room-store";
import { UniversityVideoBeamStore } from "./university-video-beam";
import { LiveKitBeamService, type LiveKitSettings } from "./livekit";

const identity: EmojiIdentity = {
  emojiId: "1F642", gender: "Male", color: "#F7C531", hairColor: "#111111",
};
function createRoom(store: RoomStore, id = "LIVEME", historyId = "history-live") {
  store.registerCommunity({ roomId: id, historyId, label: id, createdAt: new Date(0) });
}
function addMember(store: RoomStore, roomId: string, accountId: string) {
  return store.join(roomId, accountId, { accountId, identity });
}

test("video beam reserves exactly four slots under simultaneous joins and keeps room scopes isolated", async () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  createRoom(rooms, "BIGOLV", "history-bigo");
  const beam = new UniversityVideoBeamStore(rooms);
  const members = Array.from({ length: 6 }, (_, i) => addMember(rooms, "LIVEME", `account-${i}`));
  const attempts = await Promise.allSettled(members.map((member, i) =>
    Promise.resolve().then(() => beam.joinSlot("LIVEME", member.participantId, `account-${i}`))));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 4);
  assert.equal(attempts.filter(result => result.status === "rejected").length, 2);
  assert.equal(beam.getState("LIVEME").slots.filter(slot => slot.participantId).length, 4);
  assert.equal(new Set(beam.getState("LIVEME").slots.map(slot => slot.slotNumber)).size, 4);
  assert.equal(beam.getState("LIVEME").hostParticipantId, members[0]!.participantId);
  assert.equal(beam.getState("BIGOLV").slots.filter(slot => slot.participantId).length, 0);
  assert.throws(() => beam.joinSlot("LIVEME", members[4]!.participantId, "account-4"),
    (error: unknown) => error instanceof RoomError && error.status === 409);
});

test("pending permission handoff survives briefly, connected speaker disconnects free the slot", () => {
  let now = 10_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const speaker = addMember(rooms, "LIVEME", "speaker");
  beam.joinSlot("LIVEME", speaker.participantId, "speaker");
  now += 10_000;
  assert.equal(beam.reconcileLiveKitParticipants("LIVEME", new Set()).slots[0]!.participantId, speaker.participantId,
    "permission and initial connection work must not release the reservation");
  beam.markConnected("LIVEME", speaker.participantId);
  assert.equal(beam.reconcileLiveKitParticipants("LIVEME", new Set()).slots.filter(slot => slot.participantId).length, 0,
    "a connected participant missing from LiveKit is released immediately");
});

test("speaker controls are consent-based; host can only disable another speaker and kick applies cooldown", () => {
  let now = 50;
  const rooms = new RoomStore(() => now);
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const host = addMember(rooms, "LIVEME", "host");
  const speaker = addMember(rooms, "LIVEME", "speaker");
  beam.joinSlot("LIVEME", host.participantId, "host");
  beam.joinSlot("LIVEME", speaker.participantId, "speaker");

  beam.hostDisableMedia("LIVEME", host.participantId, speaker.participantId, "mic");
  beam.hostDisableMedia("LIVEME", host.participantId, speaker.participantId, "camera");
  let state = beam.getState("LIVEME");
  let controlled = state.slots.find(slot => slot.participantId === speaker.participantId)!;
  assert.equal(controlled.micMuted, true);
  assert.equal(controlled.cameraOff, true);
  assert.equal(controlled.mutedByHost, true);
  assert.equal(controlled.cameraDisabledByHost, true);

  assert.throws(() => beam.hostDisableMedia("LIVEME", speaker.participantId, host.participantId, "mic"),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.kick("LIVEME", speaker.participantId, host.participantId),
    (error: unknown) => error instanceof RoomError && error.status === 403);

  // Only the speaker's own explicit action can restore their own media.
  state = beam.setSelfMedia("LIVEME", speaker.participantId, "mic", true);
  state = beam.setSelfMedia("LIVEME", speaker.participantId, "camera", true);
  controlled = state.slots.find(slot => slot.participantId === speaker.participantId)!;
  assert.equal(controlled.micMuted, false);
  assert.equal(controlled.cameraOff, false);
  assert.equal(controlled.mutedByHost, false);
  assert.equal(controlled.cameraDisabledByHost, false);

  const kicked = beam.kick("LIVEME", host.participantId, speaker.participantId);
  assert.equal(kicked.accountId, "speaker");
  assert.equal(kicked.state.slots.filter(slot => slot.participantId).length, 1);
  assert.throws(() => beam.assertCanJoin("LIVEME", "speaker"),
    (error: unknown) => error instanceof RoomError && error.status === 409);
  now += 60_001;
  assert.doesNotThrow(() => beam.assertCanJoin("LIVEME", "speaker"));
});

test("LiveKit audience access is subscribe-only and tokens are room-scoped", async () => {
  const fakeSettings: LiveKitSettings = {
    url: "wss://live.example.test",
    apiKey: "test-public-key",
    apiSecret: "test-only-secret",
  };
  const service = new LiveKitBeamService(() => fakeSettings);
  const audience = await service.createToken({
    roomName: "streamtalk-test-room",
    participantId: "00000000-0000-4000-8000-000000000001",
    displayName: "Audience",
    role: "audience",
  });
  const claims = JSON.parse(Buffer.from(audience.token.split(".")[1]!, "base64url").toString("utf8"));
  assert.equal(audience.url, fakeSettings.url);
  assert.equal(claims.video.room, "streamtalk-test-room");
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublish, false);
  assert.equal(audience.token.includes(fakeSettings.apiSecret), false);

  const speaker = await service.createToken({
    roomName: "streamtalk-test-room",
    participantId: "00000000-0000-4000-8000-000000000002",
    displayName: "Speaker",
    role: "speaker",
  });
  const speakerClaims = JSON.parse(Buffer.from(speaker.token.split(".")[1]!, "base64url").toString("utf8"));
  assert.equal(speakerClaims.video.canPublish, true);
  assert.equal(speakerClaims.video.canSubscribe, true);
  assert.equal(speaker.token.includes(fakeSettings.apiSecret), false);
});
