import { test } from "node:test";
import assert from "node:assert/strict";
import type { EmojiIdentity } from "@workspace/api-zod";
import { RoomError, RoomStore } from "./room-store";
import { UniversityVideoBeamStore } from "./university-video-beam";
import { LiveKitBeamService, type LiveKitSettings } from "./livekit";
import { COMMUNITY_ROOMS, communityDefaultVideoSearch, isPublicTopicRoom } from "./community-config";
import { beamTvReactionLine } from "./beam-tv-reaction-policy";

const identity: EmojiIdentity = {
  emojiId: "1F642", gender: "Male", color: "#F7C531", hairColor: "#111111",
};
function createRoom(store: RoomStore, id = "LIVEME", historyId = "history-live", parentRoomId?: string) {
  store.registerCommunity({ roomId: id, historyId, label: id, createdAt: new Date(0), parentRoomId });
}
function addMember(store: RoomStore, roomId: string, accountId: string) {
  return store.join(roomId, accountId, { accountId, identity });
}

test("only the nine public topic rooms and their overflow rooms use the ownerless policy", () => {
  const rooms = new RoomStore();
  for (const item of COMMUNITY_ROOMS) createRoom(rooms, item.roomId, `history-${item.roomId}`);
  createRoom(rooms, "LIVEME2", "history-liveme-2", "LIVEME");
  rooms.registerCommunity({
    roomId: "LIVEME_TEST", historyId: "history-test", label: "test-only LiveMe",
    createdAt: new Date(0), parentRoomId: "LIVEME", testOnly: true,
  });

  for (const item of COMMUNITY_ROOMS) {
    assert.equal(isPublicTopicRoom(item.roomId, rooms), true, `${item.roomId} is a public topic room`);
  }
  assert.equal(isPublicTopicRoom("LIVEME2", rooms), true, "overflow inherits the public room policy");
  assert.equal(isPublicTopicRoom("LIVEME_TEST", rooms), false, "test-only rooms keep their own controls");
  assert.equal(isPublicTopicRoom("NOT_A_ROOM", rooms), false);
});

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
  assert.equal(beam.getState("LIVEME").hostParticipantId, null, "public topic rooms have no beam host");
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

test("no first joiner gets speaker moderation powers in a public topic room", () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms);
  const hostLikeFirstJoiner = addMember(rooms, "LIVEME", "first");
  const second = addMember(rooms, "LIVEME", "second");
  beam.joinSlot("LIVEME", hostLikeFirstJoiner.participantId, "first");
  beam.joinSlot("LIVEME", second.participantId, "second");
  assert.equal(beam.getState("LIVEME").hostParticipantId, null);
  assert.throws(() => beam.assertTvHost("LIVEME", hostLikeFirstJoiner.participantId),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.hostDisableMedia(
    "LIVEME", hostLikeFirstJoiner.participantId, second.participantId, "mic",
  ), (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.kick(
    "LIVEME", hostLikeFirstJoiner.participantId, second.participantId,
  ), (error: unknown) => error instanceof RoomError && error.status === 403);
});

test("speaker controls are consent-based; host can only disable another speaker and kick applies cooldown", () => {
  let now = 50;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "CHANNEL1", "history-channel");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const host = addMember(rooms, "CHANNEL1", "host");
  const speaker = addMember(rooms, "CHANNEL1", "speaker");
  beam.joinSlot("CHANNEL1", host.participantId, "host");
  assert.equal(typeof beam.getState("CHANNEL1").tv.searchAvailable, "boolean");
  beam.joinSlot("CHANNEL1", speaker.participantId, "speaker");

  beam.hostDisableMedia("CHANNEL1", host.participantId, speaker.participantId, "mic");
  beam.hostDisableMedia("CHANNEL1", host.participantId, speaker.participantId, "camera");
  let state = beam.getState("CHANNEL1");
  let controlled = state.slots.find(slot => slot.participantId === speaker.participantId)!;
  assert.equal(controlled.micMuted, true);
  assert.equal(controlled.cameraOff, true);
  assert.equal(controlled.mutedByHost, true);
  assert.equal(controlled.cameraDisabledByHost, true);

  assert.throws(() => beam.hostDisableMedia("CHANNEL1", speaker.participantId, host.participantId, "mic"),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.kick("CHANNEL1", speaker.participantId, host.participantId),
    (error: unknown) => error instanceof RoomError && error.status === 403);

  // Only the speaker's own explicit action can restore their own media.
  state = beam.setSelfMedia("CHANNEL1", speaker.participantId, "mic", true);
  state = beam.setSelfMedia("CHANNEL1", speaker.participantId, "camera", true);
  controlled = state.slots.find(slot => slot.participantId === speaker.participantId)!;
  assert.equal(controlled.micMuted, false);
  assert.equal(controlled.cameraOff, false);
  assert.equal(controlled.mutedByHost, false);
  assert.equal(controlled.cameraDisabledByHost, false);

  const kicked = beam.kick("CHANNEL1", host.participantId, speaker.participantId);
  assert.equal(kicked.accountId, "speaker");
  assert.equal(kicked.state.slots.filter(slot => slot.participantId).length, 1);
  assert.throws(() => beam.assertCanJoin("CHANNEL1", "speaker"),
    (error: unknown) => error instanceof RoomError && error.status === 409);
  now += 60_001;
  assert.doesNotThrow(() => beam.assertCanJoin("CHANNEL1", "speaker"));
});

test("Beam TV is host-only, shares one queue position, loops, and can be stopped and resumed", () => {
  let now = 100_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "CHANNEL1", "history-channel");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const host = addMember(rooms, "CHANNEL1", "host");
  const viewer = addMember(rooms, "CHANNEL1", "viewer");
  beam.joinSlot("CHANNEL1", host.participantId, "host");

  assert.throws(() => beam.assertTvHost("CHANNEL1", viewer.participantId),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  let state = beam.actOnTv("CHANNEL1", host.participantId, {
    action: "start",
    sourceType: "search",
    sourceValue: "late night music",
    queue: ["dQw4w9WgXcQ", "5qap5aO4i9A"],
  });
  assert.equal(state.tv.enabled, true);
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ");
  assert.equal(state.tv.startedAtMs, now);

  now += 15_000;
  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "skip" });
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A");
  assert.equal(state.tv.startedAtMs, now);
  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "skip" });
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ", "the queue repeats from its first item");

  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "stop" });
  assert.equal(state.tv.enabled, false);
  assert.equal(state.tv.queue.length, 2, "turning the TV off keeps its source for a quick restart");
  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "enable" });
  assert.equal(state.tv.enabled, true);

  assert.throws(() => beam.actOnTv("CHANNEL1", viewer.participantId, { action: "stop" }),
    (error: unknown) => error instanceof RoomError && error.status === 403);
});

test("public Beam TV keeps its default queue and only advances naturally or by room vote", () => {
  let now = 300_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms);
  createRoom(rooms, "BIGOLV", "history-bigo");
  createRoom(rooms, "A1B2C3D4E5F6", "history-overflow", "LIVEME");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const host = addMember(rooms, "LIVEME", "host");
  const viewer = addMember(rooms, "LIVEME", "viewer");
  beam.joinSlot("LIVEME", host.participantId, "host");

  const defaultSearch = communityDefaultVideoSearch("LIVEME", rooms);
  let state = beam.getState("LIVEME");
  assert.equal(state.tv.enabled, true);
  assert.equal(state.hostParticipantId, null);
  assert.equal(state.tv.sourceValue, defaultSearch);
  assert.equal(state.tv.defaultSearch, defaultSearch);
  assert.throws(() => beam.actOnTv("LIVEME", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "dQw4w9WgXcQ",
  }), (error: unknown) => error instanceof RoomError && error.status === 403,
  "audience members cannot inject a video before the server creates the default queue");
  assert.equal(
    communityDefaultVideoSearch("A1B2C3D4E5F6", rooms),
    defaultSearch,
    "overflow rooms inherit their parent room's default search",
  );
  assert.notEqual(
    communityDefaultVideoSearch("BIGOLV", rooms),
    defaultSearch,
    "each main room has its own default search",
  );

  state = beam.initializeDefaultTvQueue("LIVEME", defaultSearch, [
    { videoId: "dQw4w9WgXcQ", title: "First video", channelTitle: "Channel", description: null },
    { videoId: "5qap5aO4i9A", title: "Second video", channelTitle: "Channel", description: null },
  ], { dQw4w9WgXcQ: 10_000, "5qap5aO4i9A": 10_000 });
  assert.deepEqual(state.tv.queue, ["dQw4w9WgXcQ", "5qap5aO4i9A"]);
  assert.equal(state.tv.startedAtMs, now);
  now += 8_000;
  assert.throws(() => beam.actOnTv("LIVEME", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "5qap5aO4i9A",
    startedAtMs: now - 1_000,
  }), (error: unknown) => error instanceof RoomError && error.status === 403,
  "a participant cannot skip the current default video by publishing a different player position");
  now += 2_000;
  state = beam.getState("LIVEME");
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A", "the server advances after the current video's duration");
  state = beam.actOnTv("LIVEME", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "5qap5aO4i9A",
    startedAtMs: now - 1_000,
  });
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A", "listeners can synchronize to the server-selected video");
  assert.throws(() => beam.actOnTv("LIVEME", viewer.participantId, { action: "skip" }),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.actOnTv("LIVEME", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "another-video1",
  }), (error: unknown) => error instanceof RoomError && error.status === 403,
  "listeners can synchronize only to a video in the server-approved queue");

  assert.throws(() => beam.actOnTv("LIVEME", host.participantId, {
    action: "start",
    sourceType: "search",
    sourceValue: "host-selected live interviews",
    queue: ["dQw4w9WgXcQ"],
  }), (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.actOnTv("LIVEME", host.participantId, { action: "reset" }),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  for (const action of [
    { action: "stop" as const },
    { action: "enable" as const },
    { action: "publish-queue" as const, queue: ["dQw4w9WgXcQ"], currentVideoId: "dQw4w9WgXcQ" },
  ]) {
    assert.throws(() => beam.actOnTv("LIVEME", host.participantId, action),
      (error: unknown) => error instanceof RoomError && error.status === 403);
  }
  state = beam.getState("LIVEME");
  assert.equal(state.tv.enabled, true);
  assert.equal(state.tv.sourceValue, defaultSearch);
  assert.deepEqual(state.tv.queue, ["dQw4w9WgXcQ", "5qap5aO4i9A"]);
  assert.equal(state.tv.skipVotingEnabled, true);
});

test("Beam TV accepts a keyless playlist URL flow and synchronizes its player queue", () => {
  let now = 200_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "CHANNEL1", "history-channel");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const host = addMember(rooms, "CHANNEL1", "host");
  beam.joinSlot("CHANNEL1", host.participantId, "host");
  let state = beam.actOnTv("CHANNEL1", host.participantId, {
    action: "start",
    sourceType: "playlist",
    sourceValue: "https://www.youtube.com/playlist?list=PL1234567890abcdef",
    playlistId: "PL1234567890abcdef",
  });
  assert.equal(state.tv.enabled, true);
  assert.equal(state.tv.currentVideoId, null, "the official player supplies playlist items without Data API access");
  state = beam.actOnTv("CHANNEL1", host.participantId, {
    action: "publish-queue",
    queue: ["dQw4w9WgXcQ", "5qap5aO4i9A"],
    currentVideoId: "5qap5aO4i9A",
  });
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A");
  now += 4_000;
  state = beam.actOnTv("CHANNEL1", host.participantId, {
    action: "publish-playback",
    currentVideoId: "dQw4w9WgXcQ",
    startedAtMs: now - 8_000,
  });
  assert.equal(state.tv.startedAtMs, now - 8_000);
});

test("public Beam TV skip voting needs at least two votes and a strict majority and cannot be disabled", () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms);
  const [one, two, three, four] = Array.from({ length: 4 }, (_, index) =>
    addMember(rooms, "LIVEME", `account-${index}`));
  const defaultSearch = communityDefaultVideoSearch("LIVEME", rooms);
  beam.initializeDefaultTvQueue("LIVEME", defaultSearch, [
    { videoId: "dQw4w9WgXcQ", title: "One", channelTitle: "Channel", description: null },
    { videoId: "5qap5aO4i9A", title: "Two", channelTitle: "Channel", description: null },
    { videoId: "M7lc1UVf-VE", title: "Three", channelTitle: "Channel", description: null },
  ], { dQw4w9WgXcQ: 60_000, "5qap5aO4i9A": 60_000, "M7lc1UVf-VE": 60_000 });

  let state = beam.actOnTv("LIVEME", one!.participantId, { action: "vote-skip" }, "account-0");
  assert.equal(state.tv.skipVoteCount, 1);
  assert.equal(state.tv.skipVoteTotal, 4);
  assert.equal(state.tv.hasVotedToSkip, true);
  state = beam.actOnTv("LIVEME", one!.participantId, { action: "vote-skip" }, "account-0");
  assert.equal(state.tv.skipVoteCount, 1, "one account can only vote once for a video");
  state = beam.actOnTv("LIVEME", two!.participantId, { action: "vote-skip" }, "account-1");
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ", "two of four is not more than half");
  state = beam.actOnTv("LIVEME", three!.participantId, { action: "vote-skip" }, "account-2");
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A", "three of four passes the strict-majority threshold");
  assert.equal(state.tv.skipVoteCount, 0, "votes reset after the video advances");
  assert.equal(state.tv.hasVotedToSkip, false);

  assert.throws(() => beam.actOnTv("LIVEME", one!.participantId, {
    action: "set-skip-voting", skipVotingEnabled: false,
  }, "account-0"), (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.actOnTv("LIVEME", one!.participantId, { action: "skip" }, "account-0"),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  state = beam.getState("LIVEME");
  assert.equal(state.tv.skipVotingEnabled, true);
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A");
  assert.equal(state.tv.skipVoteTotal, 4);
  assert.ok(four);
});

test("Beam TV playlist voting advances the synced player sequence with two room members", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "CHANNEL1", "history-channel");
  const beam = new UniversityVideoBeamStore(rooms);
  const [host, viewer] = Array.from({ length: 2 }, (_, index) =>
    addMember(rooms, "CHANNEL1", `account-${index}`));
  beam.joinSlot("CHANNEL1", host!.participantId, "account-0");
  beam.actOnTv("CHANNEL1", host!.participantId, {
    action: "start",
    sourceType: "playlist",
    sourceValue: "playlist",
    playlistId: "PL1234567890",
    currentVideoId: "dQw4w9WgXcQ",
  });
  beam.actOnTv("CHANNEL1", host!.participantId, { action: "vote-skip" }, "account-0");
  const state = beam.actOnTv("CHANNEL1", viewer!.participantId, { action: "vote-skip" }, "account-1");
  assert.equal(state.tv.skipSequence, 1);
  assert.equal(state.tv.skipVoteCount, 0);
});

test("Beam TV bot reactions use only known metadata and avoid claiming scene details", () => {
  const line = beamTvReactionLine("wolf", {
    videoId: "dQw4w9WgXcQ",
    title: "Late Night Set",
    channelTitle: "Studio Channel",
    description: "An official concert performance recording.",
  });
  assert.match(line, /concert/);
  assert.match(line, /what do you think/i);
  assert.doesNotMatch(line, /the singer|the crowd|at the end/i);
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
