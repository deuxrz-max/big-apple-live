import { test } from "node:test";
import assert from "node:assert/strict";
import { TrackSource } from "livekit-server-sdk";
import type { EmojiIdentity } from "@workspace/api-zod";
import { RoomError, RoomStore } from "./room-store";
import { UniversityVideoBeamStore } from "./university-video-beam";
import { LiveKitBeamService, type LiveKitSettings } from "./livekit";
import {
  COMMUNITY_ROOMS,
  communityDefaultVideoSearch,
  communityVideoSearchPolicy,
  isPublicTopicRoom,
} from "./community-config";
import { beamTvReactionLine } from "./beam-tv-reaction-policy";

const identity: EmojiIdentity = {
  emojiId: "1F642", gender: "Male", color: "#F7C531", hairColor: "#111111",
};
function createRoom(
  store: RoomStore,
  id = "MUSIC1",
  historyId = "history-live",
  parentRoomId?: string,
  label = id,
) {
  store.registerCommunity({ roomId: id, historyId, label, createdAt: new Date(0), parentRoomId });
}
function addMember(store: RoomStore, roomId: string, accountId: string) {
  return store.join(roomId, accountId, { accountId, identity });
}

test("public topic rooms and their overflow rooms use the ownerless policy", () => {
  const rooms = new RoomStore();
  for (const item of COMMUNITY_ROOMS) {
    createRoom(rooms, item.roomId, `history-${item.roomId}`, undefined, item.label);
  }
  createRoom(rooms, "MUSIC12", "history-music-2", "MUSIC1", `${COMMUNITY_ROOMS[0]!.label} 2`);
  rooms.registerCommunity({
    roomId: "MUSIC_TEST", historyId: "history-test", label: "test-only Music",
    createdAt: new Date(0), parentRoomId: "MUSIC1", testOnly: true,
  });

  for (const item of COMMUNITY_ROOMS) {
    assert.equal(isPublicTopicRoom(item.roomId, rooms), true, `${item.roomId} is a public topic room`);
  }
  assert.equal(isPublicTopicRoom("MUSIC12", rooms), true, "overflow inherits the public room policy");
  assert.equal(isPublicTopicRoom("MUSIC_TEST", rooms), false, "test-only rooms keep their own controls");
  createRoom(rooms, "LIVEME", "history-retired", undefined, "Video Games & Interactive Media");
  assert.equal(isPublicTopicRoom("LIVEME", rooms), false, "retired room IDs are no longer public topics");
  assert.equal(isPublicTopicRoom("NOT_A_ROOM", rooms), false);
});

test("video beam reserves exactly eight slots under simultaneous joins and keeps room scopes isolated", async () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  createRoom(rooms, "GAMING", "history-gaming");
  const beam = new UniversityVideoBeamStore(rooms);
  const members = Array.from({ length: 10 }, (_, i) => addMember(rooms, "MUSIC1", `account-${i}`));
  const attempts = await Promise.allSettled(members.map((member, i) =>
    Promise.resolve().then(() => beam.joinSlot("MUSIC1", member.participantId, `account-${i}`))));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 8);
  assert.equal(attempts.filter(result => result.status === "rejected").length, 2);
  assert.equal(beam.getState("MUSIC1").slots.filter(slot => slot.participantId).length, 8);
  assert.equal(new Set(beam.getState("MUSIC1").slots.map(slot => slot.slotNumber)).size, 8);
  assert.equal(beam.getState("MUSIC1").hostParticipantId, null, "public topic rooms have no beam host");
  assert.equal(beam.getState("GAMING").slots.filter(slot => slot.participantId).length, 0);
  assert.throws(() => beam.joinSlot("MUSIC1", members[8]!.participantId, "account-8"),
    (error: unknown) => error instanceof RoomError && error.status === 409);
});

test("pending permission handoff survives briefly, connected speaker disconnects free the slot", () => {
  let now = 10_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const speaker = addMember(rooms, "MUSIC1", "speaker");
  beam.joinSlot("MUSIC1", speaker.participantId, "speaker");
  now += 10_000;
  assert.equal(beam.reconcileLiveKitParticipants("MUSIC1", new Set()).slots[0]!.participantId, speaker.participantId,
    "permission and initial connection work must not release the reservation");
  beam.markConnected("MUSIC1", speaker.participantId);
  assert.equal(beam.reconcileLiveKitParticipants("MUSIC1", new Set()).slots.filter(slot => slot.participantId).length, 0,
    "a connected participant missing from LiveKit is released immediately");
});

test("no first joiner gets speaker moderation powers in a public topic room", () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms);
  const hostLikeFirstJoiner = addMember(rooms, "MUSIC1", "first");
  const second = addMember(rooms, "MUSIC1", "second");
  beam.joinSlot("MUSIC1", hostLikeFirstJoiner.participantId, "first");
  beam.joinSlot("MUSIC1", second.participantId, "second");
  assert.equal(beam.getState("MUSIC1").hostParticipantId, null);
  assert.throws(() => beam.assertTvHost("MUSIC1", hostLikeFirstJoiner.participantId),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.hostDisableMedia(
    "MUSIC1", hostLikeFirstJoiner.participantId, second.participantId, "mic",
  ), (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.kick(
    "MUSIC1", hostLikeFirstJoiner.participantId, second.participantId,
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
  assert.equal(state.tv.micLockedDuringVideo, false,
    "the automatic topic-room intermission policy does not change older host-controlled rooms");

  now += 15_000;
  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "skip" });
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A");
  assert.equal(state.tv.startedAtMs, now);
  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "skip" });
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ", "the queue repeats from its first item");

  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "stop" });
  assert.equal(state.tv.enabled, false);
  assert.equal(state.tv.micLockedDuringVideo, false);
  assert.equal(state.tv.queue.length, 2, "turning the TV off keeps its source for a quick restart");
  state = beam.actOnTv("CHANNEL1", host.participantId, { action: "enable" });
  assert.equal(state.tv.enabled, true);

  assert.throws(() => beam.actOnTv("CHANNEL1", viewer.participantId, { action: "stop" }),
    (error: unknown) => error instanceof RoomError && error.status === 403);
});

test("public Beam TV uses its curated topic search and holds a synchronized intermission", () => {
  let now = 300_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "MUSIC1", "history-music", undefined, "Music");
  createRoom(rooms, "GAMING", "history-gaming", undefined, "Gaming");
  createRoom(rooms, "A1B2C3D4E5F6", "history-overflow", "MUSIC1", "Music 2");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const host = addMember(rooms, "MUSIC1", "host");
  const viewer = addMember(rooms, "MUSIC1", "viewer");
  beam.joinSlot("MUSIC1", host.participantId, "host");

  const defaultSearch = communityDefaultVideoSearch("MUSIC1", rooms);
  let state = beam.getState("MUSIC1");
  assert.equal(state.tv.enabled, true);
  assert.equal(state.hostParticipantId, null);
  assert.equal(state.tv.sourceValue, defaultSearch);
  assert.equal(state.tv.defaultSearch, defaultSearch);
  assert.throws(() => beam.actOnTv("MUSIC1", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "dQw4w9WgXcQ",
  }), (error: unknown) => error instanceof RoomError && error.status === 403,
  "audience members cannot inject a video before the server creates the default queue");
  assert.equal(defaultSearch, "popular official music videos and new song releases");
  assert.equal(communityDefaultVideoSearch("A1B2C3D4E5F6", rooms), defaultSearch,
    "overflow rooms inherit their parent's category search");
  assert.notEqual(
    communityDefaultVideoSearch("GAMING", rooms),
    defaultSearch,
    "each main room has its own default search",
  );

  state = beam.initializeDefaultTvQueue("MUSIC1", defaultSearch, [
    { videoId: "dQw4w9WgXcQ", title: "First video", channelTitle: "Channel", description: null },
    { videoId: "5qap5aO4i9A", title: "Second video", channelTitle: "Channel", description: null },
  ], { dQw4w9WgXcQ: 10_000, "5qap5aO4i9A": 10_000 });
  assert.deepEqual(state.tv.queue, ["dQw4w9WgXcQ", "5qap5aO4i9A"]);
  assert.equal(state.tv.startedAtMs, now);
  assert.equal(beam.getNextAutomaticPlaybackTransitionAt("MUSIC1"), now + 10_000);
  assert.equal(state.tv.micLockedDuringVideo, true);
  assert.equal(state.tv.breakEndsAtMs, null);
  assert.throws(() => beam.setSelfMedia("MUSIC1", host.participantId, "mic", true),
    (error: unknown) => error instanceof RoomError && error.status === 409,
    "the server rejects attempts to enable a microphone during playback");
  state = beam.joinSlot("MUSIC1", viewer.participantId, "viewer");
  assert.equal(state.slots.find(slot => slot.participantId === viewer.participantId)?.micMuted, true,
    "a speaker joining mid-video starts muted");
  now += 8_000;
  assert.throws(() => beam.actOnTv("MUSIC1", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "5qap5aO4i9A",
    startedAtMs: now - 1_000,
  }), (error: unknown) => error instanceof RoomError && error.status === 403,
  "a participant cannot skip the current default video by publishing a different player position");
  now += 2_000;
  state = beam.getState("MUSIC1");
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ", "the current video remains selected during its intermission");
  assert.equal(state.tv.breakEndsAtMs, now + 180_000);
  assert.equal(state.tv.micLockedDuringVideo, false, "microphones unlock during the intermission");
  assert.equal(state.tv.serverNowMs, now);
  assert.throws(() => beam.actOnTv("MUSIC1", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "dQw4w9WgXcQ",
    startedAtMs: now - 1_000,
  }), (error: unknown) => error instanceof RoomError && error.status === 403,
  "public playback synchronization stays closed during the intermission");
  state = beam.setSelfMedia("MUSIC1", host.participantId, "mic", false);
  assert.equal(state.slots.find(slot => slot.participantId === host.participantId)?.micMuted, true);
  assert.equal(state.slots.find(slot => slot.participantId === viewer.participantId)?.micMuted, true,
    "a person who joined while locked is not automatically unmuted");
  const breakEndsAt = state.tv.breakEndsAtMs!;
  assert.equal(beam.getNextAutomaticPlaybackTransitionAt("MUSIC1"), breakEndsAt);
  now = breakEndsAt - 1;
  state = beam.getState("MUSIC1");
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ");
  assert.equal(state.tv.micLockedDuringVideo, false);
  now = breakEndsAt;
  state = beam.getState("MUSIC1");
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A", "the next video starts when the shared break ends");
  assert.equal(state.tv.startedAtMs, breakEndsAt);
  assert.equal(state.tv.breakEndsAtMs, null);
  assert.equal(state.tv.micLockedDuringVideo, true);
  assert.equal(beam.getNextAutomaticPlaybackTransitionAt("MUSIC1"), breakEndsAt + 10_000);
  state = beam.actOnTv("MUSIC1", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "5qap5aO4i9A",
    startedAtMs: now - 1_000,
  });
  assert.equal(state.tv.startedAtMs, breakEndsAt,
    "players sync to the server's next-video start instead of resetting its clock");
  assert.equal(state.slots.find(slot => slot.participantId === host.participantId)?.micMuted, true,
    "a manual mute during the break remains in effect for the next video");
  assert.equal(state.slots.find(slot => slot.participantId === viewer.participantId)?.micMuted, true);
  assert.throws(() => beam.setSelfMedia("MUSIC1", viewer.participantId, "mic", true),
    (error: unknown) => error instanceof RoomError && error.status === 409);
  state = beam.actOnTv("MUSIC1", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "5qap5aO4i9A",
    startedAtMs: now - 1_000,
  });
  assert.equal(state.tv.startedAtMs, breakEndsAt,
    "player sync cannot reset the server-selected video start time");
  assert.throws(() => beam.actOnTv("MUSIC1", viewer.participantId, { action: "skip" }),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.actOnTv("MUSIC1", viewer.participantId, {
    action: "publish-playback",
    currentVideoId: "another-video1",
  }), (error: unknown) => error instanceof RoomError && error.status === 403,
  "listeners can synchronize only to a video in the server-approved queue");

  assert.throws(() => beam.actOnTv("MUSIC1", host.participantId, {
    action: "start",
    sourceType: "search",
    sourceValue: "host-selected live interviews",
    queue: ["dQw4w9WgXcQ"],
  }), (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.actOnTv("MUSIC1", host.participantId, { action: "reset" }),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  for (const action of [
    { action: "stop" as const },
    { action: "enable" as const },
    { action: "publish-queue" as const, queue: ["dQw4w9WgXcQ"], currentVideoId: "dQw4w9WgXcQ" },
  ]) {
    assert.throws(() => beam.actOnTv("MUSIC1", host.participantId, action),
      (error: unknown) => error instanceof RoomError && error.status === 403);
  }
  state = beam.getState("MUSIC1");
  assert.equal(state.tv.enabled, true);
  assert.equal(state.tv.sourceValue, defaultSearch);
  assert.deepEqual(state.tv.queue, ["dQw4w9WgXcQ", "5qap5aO4i9A"]);
  assert.equal(state.tv.skipVotingEnabled, false);
});

test("all 20 categories use recent popular searches across their overflow rooms", () => {
  const rooms = new RoomStore();
  for (const room of COMMUNITY_ROOMS) {
    createRoom(rooms, room.roomId, `history-${room.roomId}`, undefined, room.label);
    const overflowId = `${room.roomId}2`;
    createRoom(rooms, overflowId, `history-${overflowId}`, room.roomId, `${room.label} 2`);
    const query = communityDefaultVideoSearch(room.roomId, rooms);
    assert.equal(query, room.defaultVideoSearch, `${room.label} uses its configured topic search`);
    assert.equal(communityDefaultVideoSearch(overflowId, rooms), query,
      `${room.label} overflow inherits the same topic search`);
    const policy = communityVideoSearchPolicy(overflowId, rooms);
    assert.equal(policy?.order, "viewCount", `${room.label} sorts recent results by popularity`);
    assert.ok(policy?.publishedWithinDays && policy.publishedWithinDays > 0);
    assert.equal(isPublicTopicRoom(overflowId, rooms), true);
  }
  assert.equal(COMMUNITY_ROOMS.length, 20);
  assert.equal(communityVideoSearchPolicy("KIDS01", rooms)?.trustedChannelTitles?.length, 12);
  const newsPolicy = communityVideoSearchPolicy("NEWS01", rooms);
  assert.equal(newsPolicy?.publishedWithinDays, 7);
  assert.ok(newsPolicy?.trustedChannelTitles?.includes("Reuters"));
  assert.ok(newsPolicy?.trustedChannelTitles?.includes("BBC News"));
});

test("a speaker muted by choice stays muted when a video ends and the break begins", () => {
  let now = 700_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "MUSIC1", "history-music", undefined, "Music");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const speaker = addMember(rooms, "MUSIC1", "speaker");
  beam.joinSlot("MUSIC1", speaker.participantId, "speaker");
  beam.setSelfMedia("MUSIC1", speaker.participantId, "mic", false);
  beam.initializeDefaultTvQueue("MUSIC1", "popular official music videos and new song releases", [
    { videoId: "dQw4w9WgXcQ", title: "First", channelTitle: "Channel", description: null },
    { videoId: "5qap5aO4i9A", title: "Second", channelTitle: "Channel", description: null },
  ], { dQw4w9WgXcQ: 5_000, "5qap5aO4i9A": 5_000 });
  now += 5_000;
  const state = beam.getState("MUSIC1");
  assert.equal(state.tv.micLockedDuringVideo, false);
  assert.equal(state.slots.find(slot => slot.participantId === speaker.participantId)?.micMuted, true);
});

test("public Beam TV keeps its curated search independent of a room display label", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "MUSIC1", "history-music", undefined, "Music");
  const beam = new UniversityVideoBeamStore(rooms);
  const oldSearch = communityDefaultVideoSearch("MUSIC1", rooms);
  beam.initializeDefaultTvQueue("MUSIC1", oldSearch, [
    { videoId: "dQw4w9WgXcQ", title: "Old room result", channelTitle: "Channel", description: null },
  ], { dQw4w9WgXcQ: 60_000 });

  createRoom(rooms, "MUSIC1", "history-music", undefined, "Updated room title");
  const state = beam.getState("MUSIC1");
  assert.equal(state.tv.defaultSearch, oldSearch,
    "fixed categories use their curated search, not a renamed room title");
  assert.equal(state.tv.sourceValue, oldSearch);
  assert.deepEqual(state.tv.queue, ["dQw4w9WgXcQ"]);
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

test("public Beam TV has no viewer or host controls to vote, skip or change the queue", () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms);
  const [one] = Array.from({ length: 1 }, (_, index) =>
    addMember(rooms, "MUSIC1", `account-${index}`));
  const defaultSearch = communityDefaultVideoSearch("MUSIC1", rooms);
  beam.initializeDefaultTvQueue("MUSIC1", defaultSearch, [
    { videoId: "dQw4w9WgXcQ", title: "One", channelTitle: "Channel", description: null },
    { videoId: "5qap5aO4i9A", title: "Two", channelTitle: "Channel", description: null },
    { videoId: "M7lc1UVf-VE", title: "Three", channelTitle: "Channel", description: null },
  ], { dQw4w9WgXcQ: 60_000, "5qap5aO4i9A": 60_000, "M7lc1UVf-VE": 60_000 });

  assert.throws(() => beam.actOnTv("MUSIC1", one!.participantId, { action: "vote-skip" }, "account-0"),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.actOnTv("MUSIC1", one!.participantId, { action: "skip" }, "account-0"),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.actOnTv("MUSIC1", one!.participantId, {
    action: "start", sourceType: "search", sourceValue: "manual", queue: ["dQw4w9WgXcQ"],
  }, "account-0"), (error: unknown) => error instanceof RoomError && error.status === 403);
  const state = beam.getState("MUSIC1");
  assert.equal(state.tv.skipVotingEnabled, false);
  assert.equal(state.tv.skipVoteCount, 0);
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ");
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
  assert.deepEqual(speakerClaims.video.canPublishSources, ["camera"],
    "speaker tokens do not initially grant microphone publishing");
  assert.equal(speaker.token.includes(fakeSettings.apiSecret), false);

  const policyUpdates: Array<{ sources: TrackSource[]; muted: boolean }> = [];
  const policyClient = {
    getParticipant: async () => ({ tracks: [{ source: TrackSource.MICROPHONE, sid: "mic-track" }] }),
    updateParticipant: async (_room: string, _participant: string,
      update: { permission: { canPublish: boolean; canPublishSources: TrackSource[] } }) => {
      policyUpdates.push({ sources: update.permission.canPublishSources, muted: false });
    },
    mutePublishedTrack: async (_room: string, _participant: string, _track: string, muted: boolean) => {
      policyUpdates.at(-1)!.muted = muted;
    },
  };
  const policyService = new LiveKitBeamService(
    () => fakeSettings,
    () => policyClient as unknown as import("livekit-server-sdk").RoomServiceClient,
  );
  await policyService.applySpeakerMediaPolicy("streamtalk-test-room", "speaker", [TrackSource.CAMERA], false);
  await policyService.applySpeakerMediaPolicy(
    "streamtalk-test-room", "speaker", [TrackSource.CAMERA, TrackSource.MICROPHONE], true,
  );
  assert.deepEqual(policyUpdates.map(update => update.muted), [true, false],
    "server-side media policy mutes during video and restores only the previously allowed state");
  assert.deepEqual(policyUpdates[0]?.sources, [TrackSource.CAMERA]);
});
