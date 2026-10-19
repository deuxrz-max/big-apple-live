import { test } from "node:test";
import assert from "node:assert/strict";
import { TrackSource } from "livekit-server-sdk";
import type { EmojiIdentity } from "@workspace/api-zod";
import { RoomError, RoomStore } from "./room-store";
import { UniversityVideoBeamStore } from "./university-video-beam";
import { LiveKitBeamService, type LiveKitSettings } from "./livekit";
import {
  COMMUNITY_ROOMS,
  COMMUNITY_VIDEO_POOL_ROOMS,
  DIRECTORY_COMMUNITY_ROOMS,
  DIRECTORY_COMMUNITY_ROOM_IDS,
  communityDefaultVideoSearch,
  communityOfficialChannelSearchPolicy,
  communityLiveStreamPolicy,
  communityVideoSearchPolicy,
  communityVideoUploadChannels,
  communityVideoPlaylists,
  communityWrestlingSearchPolicy,
  isCommunityDailyWebSeriesRoom,
  isPublicTopicRoom,
} from "./community-config";
import { beamTvReactionLine } from "./beam-tv-reaction-policy";

const identity: EmojiIdentity = {
  emojiId: "1F642", gender: "Male", color: "#F7C531", hairColor: "#111111",
};

test("Comedy is a public topic room with the configured YouTube sources", () => {
  assert.equal(DIRECTORY_COMMUNITY_ROOMS.find(room => room.roomId === "COMEDY")?.label, "Comedy");
  assert.deepEqual(communityVideoUploadChannels("COMEDY").map(source => [source.channelHandle, source.sourceTag]), [
    ["@JkDAnimator", "jkdanimator"],
    ["@ComedyCentral", "comedycentral"],
  ]);
  assert.deepEqual(communityVideoPlaylists("COMEDY"), [{
    playlistId: "PLEMjCJwHb6w1UqDzZngrOKqbAW3AD9mxa",
    sourceTag: "playlist",
    sourceTitle: "Playlist",
  }]);
});

test("Comedy playback restores the server schedule and advances continuously without a member action", () => {
  const rooms = new RoomStore(() => 1_000);
  createRoom(rooms, "COMEDY", "history-comedy", undefined, "Comedy");
  let now = 1_000;
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const videos = [
    { videoId: "abc12345678", title: "Joke video", channelTitle: "JkDAnimator", description: null },
    { videoId: "def12345678", title: "Another joke", channelTitle: "Comedy Central", description: null },
  ];
  const started = beam.initializeDefaultTvQueue(
    "COMEDY", communityDefaultVideoSearch("COMEDY", rooms), videos,
    { "abc12345678": 1_000, "def12345678": 1_000 },
  );
  assert.equal(started.tv.currentVideoId, "abc12345678");
  assert.deepEqual(started.tv.queue, ["abc12345678", "def12345678"]);
  assert.equal(started.tv.micLockedDuringVideo, false);

  now = 2_000;
  const next = beam.advanceAutomaticDefaultTvVideo(
    "COMEDY", videos, { "abc12345678": 1_000, "def12345678": 1_000 },
    "def12345678", "abc12345678", 1_000, null, undefined, 2_000,
  );
  assert.equal(next.tv.currentVideoId, "def12345678");
  assert.equal(next.tv.startedAtMs, 2_000);
  assert.equal(next.tv.breakEndsAtMs, null);
  assert.equal(next.tv.micLockedDuringVideo, false);

  const restoredStore = new UniversityVideoBeamStore(rooms, () => 2_500);
  const restored = restoredStore.restoreAutomaticDefaultTvQueue(
    "COMEDY",
    videos,
    { "abc12345678": 1_000, "def12345678": 1_000 },
    "def12345678",
    2_000,
    null,
  );
  assert.equal(restored.tv.currentVideoId, "def12345678");
  assert.equal(restored.tv.startedAtMs, 2_000);
  assert.equal(restored.tv.micLockedDuringVideo, false);
});

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
    assert.equal(isPublicTopicRoom(item.roomId, rooms), DIRECTORY_COMMUNITY_ROOM_IDS.includes(item.roomId as typeof DIRECTORY_COMMUNITY_ROOM_IDS[number]),
      `${item.roomId} public visibility follows the shortened Directory`);
  }
  assert.equal(isPublicTopicRoom("MUSIC12", rooms), true, "overflow inherits the public room policy");
  createRoom(rooms, "GAMING12", "history-gaming-2", "GAMING", "Gaming 2");
  assert.equal(isPublicTopicRoom("GAMING12", rooms), false, "hidden-topic overflow rooms cannot be entered");
  assert.equal(isPublicTopicRoom("MUSIC_TEST", rooms), false, "test-only rooms keep their own controls");
  createRoom(rooms, "LIVEME", "history-retired", undefined, "Video Games & Interactive Media");
  assert.equal(isPublicTopicRoom("LIVEME", rooms), false, "retired room IDs are no longer public topics");
  assert.equal(isPublicTopicRoom("NOT_A_ROOM", rooms), false);
  assert.deepEqual(DIRECTORY_COMMUNITY_ROOMS.map(room => room.label), [
    "Music", "Movies", "Comedy", "Sports", "Pro Wrestling", "Web Series", "History", "News",
  ]);
  assert.deepEqual(COMMUNITY_VIDEO_POOL_ROOMS.map(room => room.label), [
    "Music", "Movies", "Comedy", "Sports", "Pro Wrestling", "History",
  ], "hidden rooms and the special News/Web Series sources are not scheduled for topic-pool searches");
});

test("public room timeline advances through its saved queue while nobody is watching", () => {
  let now = 1_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const defaultSearch = communityDefaultVideoSearch("MUSIC1", rooms)!;
  const first = { videoId: "aaa11111111", title: "First", channelTitle: "Music", description: null };
  const second = { videoId: "bbb22222222", title: "Second", channelTitle: "Music", description: null };
  beam.initializeDefaultTvQueue("MUSIC1", defaultSearch, [first, second], {
    [first.videoId]: 1_000,
    [second.videoId]: 2_000,
  });
  now = 1_000 + 1_000 + 3 * 60_000;
  let state = beam.getState("MUSIC1");
  assert.equal(state.tv.currentVideoId, first.videoId);
  const transitionAt = state.tv.breakEndsAtMs!;
  assert.equal(beam.getNextAutomaticPlaybackTransitionAt("MUSIC1"), null,
    "an expired break is ready for the room scheduler to advance");
  state = beam.advanceAutomaticDefaultTvQueue(
    "MUSIC1", second.videoId, first.videoId, 1_000, transitionAt, transitionAt,
  );
  assert.equal(state.tv.currentVideoId, second.videoId);
  assert.equal(state.tv.startedAtMs, transitionAt);
  assert.deepEqual(state.tv.queue, [first.videoId, second.videoId]);

  now = transitionAt + 2_000 + 3 * 60_000;
  state = beam.getState("MUSIC1");
  const loopAt = state.tv.breakEndsAtMs!;
  state = beam.advanceAutomaticDefaultTvQueue(
    "MUSIC1", first.videoId, second.videoId, transitionAt, loopAt, loopAt,
  );
  assert.equal(state.tv.currentVideoId, first.videoId, "the saved room playlist loops");
  assert.equal(state.tv.startedAtMs, loopAt);
  assert.deepEqual(state.tv.queue, [first.videoId, second.videoId]);
});

test("an official player failure immediately advances the ownerless topic room", () => {
  let now = 1_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const defaultSearch = communityDefaultVideoSearch("MUSIC1", rooms)!;
  const failed = { videoId: "aaa11111111", title: "Unavailable", channelTitle: "Music", description: null };
  const next = { videoId: "bbb22222222", title: "Playable next", channelTitle: "Music", description: null };
  beam.initializeDefaultTvQueue("MUSIC1", defaultSearch, [failed, next], {
    [failed.videoId]: 1_000,
    [next.videoId]: 2_000,
  });
  now += 1_000;

  const state = beam.advanceAutomaticVideoAfterPlayerFailure(
    "MUSIC1", [next], { [next.videoId]: 2_000 }, failed.videoId, next.videoId,
  );
  assert.equal(state.tv.currentVideoId, next.videoId);
  assert.equal(state.tv.startedAtMs, now);
  assert.equal(state.tv.breakEndsAtMs, null);
  assert.deepEqual(state.tv.queue, [next.videoId]);
});

test("default Beam TV queue clips long YouTube descriptions before exposing state", () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms);
  const video = {
    videoId: "dQw4w9WgXcQ",
    title: "A long-description video",
    channelTitle: "Channel",
    description: "description ".repeat(100),
  };
  const state = beam.initializeDefaultTvQueue(
    "MUSIC1",
    communityDefaultVideoSearch("MUSIC1", rooms)!,
    [video],
    { [video.videoId]: 1_000 },
  );
  assert.equal(state.tv.videoMetadata[0]?.description?.length, 500);
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

test("moving a speaker to another open seat preserves the live seat session", () => {
  let now = 10_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const speaker = addMember(rooms, "MUSIC1", "speaker");
  const lifecycle: string[] = [];
  beam.setSeatLifecycleListener(event => lifecycle.push(event.type));
  beam.joinSlot("MUSIC1", speaker.participantId, "speaker");
  beam.markConnected("MUSIC1", speaker.participantId);
  beam.setSelfMedia("MUSIC1", speaker.participantId, "mic", true);
  for (let minute = 0; minute < 15; minute += 1) {
    now += 60_000;
    rooms.heartbeat("MUSIC1", speaker.participantSessionId);
  }

  const moved = beam.moveSlot("MUSIC1", speaker.participantId, "speaker", 8);
  assert.equal(moved.slots[0]!.participantId, null);
  assert.equal(moved.slots[7]!.participantId, speaker.participantId);
  assert.equal(moved.slots[7]!.micMuted, false);
  assert.deepEqual(lifecycle, ["joined"], "a seat move must not emit a leave/reset event");
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

test("Go Live exclusivity detects only a live beam mic and mutes the speaker slot", () => {
  const rooms = new RoomStore();
  createRoom(rooms);
  const beam = new UniversityVideoBeamStore(rooms);
  const speaker = addMember(rooms, "MUSIC1", "speaker");
  beam.joinSlot("MUSIC1", speaker.participantId, "speaker");
  assert.equal(beam.isAccountMicrophoneActive("speaker"), false);
  beam.markConnected("MUSIC1", speaker.participantId);
  assert.equal(beam.isAccountMicrophoneActive("speaker"), true);

  beam.setSelfMedia("MUSIC1", speaker.participantId, "mic", true);
  assert.equal(beam.isAccountMicrophoneActive("speaker"), true);
  assert.deepEqual(beam.muteAccountMicrophones("speaker"), [{
    roomId: "MUSIC1",
    participantId: speaker.participantId,
  }]);
  assert.equal(beam.isAccountMicrophoneActive("speaker"), false);
  assert.equal(beam.getState("MUSIC1").slots[0]?.micMuted, true);
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
  let state = beam.getState("CHANNEL1");
  let controlled = state.slots.find(slot => slot.participantId === speaker.participantId)!;
  assert.equal(controlled.micMuted, true);
  assert.equal(controlled.cameraOff, true);
  assert.equal(controlled.mutedByHost, true);
  assert.equal(controlled.cameraDisabledByHost, false);
  assert.throws(() => beam.hostDisableMedia("CHANNEL1", host.participantId, speaker.participantId, "camera"),
    (error: unknown) => error instanceof RoomError && error.status === 410);

  assert.throws(() => beam.hostDisableMedia("CHANNEL1", speaker.participantId, host.participantId, "mic"),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  assert.throws(() => beam.kick("CHANNEL1", speaker.participantId, host.participantId),
    (error: unknown) => error instanceof RoomError && error.status === 403);

  // Only the speaker's own explicit action can restore their own media.
  state = beam.setSelfMedia("CHANNEL1", speaker.participantId, "mic", true);
  controlled = state.slots.find(slot => slot.participantId === speaker.participantId)!;
  assert.equal(controlled.micMuted, false);
  assert.equal(controlled.cameraOff, true);
  assert.equal(controlled.mutedByHost, false);
  assert.equal(controlled.cameraDisabledByHost, false);
  assert.throws(() => beam.setSelfMedia("CHANNEL1", speaker.participantId, "camera", true),
    (error: unknown) => error instanceof RoomError && error.status === 410);

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
  assert.equal(defaultSearch, "popular official artist music videos");
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
  assert.equal(state.tv.micLockedDuringVideo, false);
  assert.equal(state.tv.breakEndsAtMs, null);
  state = beam.setSelfMedia("MUSIC1", host.participantId, "mic", true);
  assert.equal(state.slots.find(slot => slot.participantId === host.participantId)?.micMuted, false,
    "a seated participant can enable their mic during playback");
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ");
  assert.equal(state.tv.startedAtMs, now, "changing microphone state preserves the shared video clock");
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
  assert.equal(state.tv.micLockedDuringVideo, false, "video intermission does not change microphone availability");
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
  assert.equal(state.tv.currentVideoId, "dQw4w9WgXcQ",
    "public topic playback waits for the server's saved-pool rotation at break end");
  state = beam.advanceAutomaticDefaultTvVideo(
    "MUSIC1",
    [
      { videoId: "5qap5aO4i9A", title: "Second video", channelTitle: "Channel", description: null },
      { videoId: "dQw4w9WgXcQ", title: "First video", channelTitle: "Channel", description: null },
    ],
    { dQw4w9WgXcQ: 10_000, "5qap5aO4i9A": 10_000 },
    "5qap5aO4i9A",
    "dQw4w9WgXcQ",
    300_000,
    breakEndsAt,
  );
  assert.equal(state.tv.currentVideoId, "5qap5aO4i9A", "the next video starts when the shared break ends");
  assert.equal(state.tv.startedAtMs, breakEndsAt);
  assert.equal(state.tv.breakEndsAtMs, null);
  assert.equal(state.tv.micLockedDuringVideo, false);
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
  state = beam.setSelfMedia("MUSIC1", viewer.participantId, "mic", true);
  assert.equal(state.slots.find(slot => slot.participantId === viewer.participantId)?.micMuted, false,
    "a seated participant can toggle the mic on during the next video as well");
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
  assert.deepEqual(state.tv.queue, ["5qap5aO4i9A", "dQw4w9WgXcQ"]);
  assert.equal(state.tv.skipVotingEnabled, false);
});

test("all configured categories use their settings across overflow rooms", () => {
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
    if (room.label === "News") {
      assert.equal(policy?.order, "date", "News falls back to CNN's latest uploads");
      assert.equal(policy?.publishedWithinDays, undefined);
      assert.deepEqual(policy?.trustedChannelTitles, ["CNN"]);
    } else if (room.label === "Pro Wrestling") {
      assert.equal(policy?.order, "date");
      assert.equal(policy?.publishedWithinDays, undefined);
      assert.deepEqual(policy?.trustedChannelTitles, [
        "All Elite Wrestling", "WWE", "TNA Wrestling", "Ring of Honor Wrestling",
      ]);
    } else if (room.label === "History") {
      assert.equal(policy?.order, "date");
      assert.deepEqual(policy?.trustedChannelTitles, ["HISTORY"]);
      assert.equal(communityOfficialChannelSearchPolicy(overflowId, rooms)?.channelHandle, "@HISTORY");
      assert.equal(communityOfficialChannelSearchPolicy(overflowId, rooms)?.query,
        "full episodes The Men Who Built America documentary");
    } else if (room.label === "Web Series") {
      assert.equal(room.dailyWebSeries, true);
      assert.equal(isCommunityDailyWebSeriesRoom(room.roomId, rooms), true);
      assert.equal(isCommunityDailyWebSeriesRoom(overflowId, rooms), true,
        "Web Series overflow rooms inherit the daily series selection");
    } else if (room.label === "Movies") {
      assert.equal(policy?.order, "viewCount");
      assert.equal(policy?.publishedWithinDays, undefined);
      assert.ok((policy?.trustedChannelTitles?.length ?? 0) > 0);
    } else {
      assert.equal(policy?.order, "viewCount", `${room.label} sorts recent results by popularity`);
      assert.ok(policy?.publishedWithinDays && policy.publishedWithinDays > 0,
        `${room.label} provides a bounded recent-search policy`);
    }
    assert.equal(
      isPublicTopicRoom(overflowId, rooms),
      DIRECTORY_COMMUNITY_ROOM_IDS.includes(room.roomId as typeof DIRECTORY_COMMUNITY_ROOM_IDS[number]),
      `${room.label} overflow visibility follows the shortened Directory`,
    );
  }
  assert.equal(COMMUNITY_ROOMS.length, 21);
  const wrestlingPolicy = communityWrestlingSearchPolicy("KIDS01", rooms);
  assert.deepEqual(wrestlingPolicy?.channels.map(channel => channel.channelTitle),
    ["All Elite Wrestling", "WWE", "TNA Wrestling", "Ring of Honor Wrestling"]);
  assert.deepEqual(
    communityWrestlingSearchPolicy("KIDS012", rooms)?.channels.map(channel => channel.channelId),
    wrestlingPolicy?.channels.map(channel => channel.channelId),
    "the Pro Wrestling overflow inherits the exact official channel allowlist",
  );
  assert.equal(wrestlingPolicy?.cacheTtlMs, 6 * 60 * 60_000);
  const historyPolicy = communityOfficialChannelSearchPolicy("HIST01", rooms);
  assert.equal(historyPolicy?.channelHandle, "@HISTORY");
  assert.equal(historyPolicy?.channelTitle, "HISTORY");
  const newsPolicy = communityVideoSearchPolicy("NEWS01", rooms);
  assert.equal(newsPolicy?.order, "date");
  assert.equal(newsPolicy?.publishedWithinDays, undefined);
  assert.deepEqual(newsPolicy?.trustedChannelTitles, ["CNN"]);
  assert.equal(communityLiveStreamPolicy("NEWS01", rooms)?.streamTitle, "CNN Headlines: 24/7 Live News");
  assert.equal(communityLiveStreamPolicy("NEWS012", rooms)?.streamTitle, "CNN Headlines: 24/7 Live News",
    "News overflow inherits the parent live-stream setup");
});

test("Web Series plays episodes in order, loops, and carries its title through the break", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "WEBSER", "history-web-series", undefined, "Web Series");
  let now = 1_000_000;
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const episodes = [1, 2, 3].map(index => ({
    videoId: `W${String(index).padStart(10, "0")}`,
    title: `Night Story - Episode ${index}`,
    channelTitle: "Example",
    description: null,
  }));
  const durations = Object.fromEntries(episodes.map(episode => [episode.videoId, 60_000]));
  let state = beam.replaceDailyWebSeries(
    "WEBSER",
    communityDefaultVideoSearch("WEBSER", rooms),
    "2026-10-13",
    { title: "Night Story", episodes, durationMsByVideoId: durations },
  );
  assert.equal(state.tv.seriesTitle, "Night Story");
  assert.equal(state.tv.seriesDate?.toISOString().slice(0, 10), "2026-10-13");
  assert.equal(state.tv.seriesEpisodeNumber, 1);
  assert.equal(state.tv.currentVideoId, episodes[0]?.videoId);

  for (const expectedEpisode of [2, 3, 1]) {
    now += 60_000;
    beam.getNextAutomaticPlaybackTransitionAt("WEBSER");
    state = beam.getState("WEBSER");
    assert.equal(state.tv.breakEndsAtMs, now + 3 * 60_000);
    now = state.tv.breakEndsAtMs!;
    beam.getNextAutomaticPlaybackTransitionAt("WEBSER");
    const next = episodes[expectedEpisode - 1]!;
    state = beam.advanceAutomaticDefaultTvVideo(
      "WEBSER",
      episodes,
      durations,
      next.videoId,
      state.tv.currentVideoId!,
      state.tv.startedAtMs!,
      state.tv.breakEndsAtMs!,
      { title: "Night Story", date: "2026-10-13", episodeNumber: expectedEpisode },
    );
    assert.equal(state.tv.currentVideoId, next.videoId);
    assert.equal(state.tv.seriesTitle, "Night Story");
    assert.equal(state.tv.seriesEpisodeNumber, expectedEpisode);
    assert.equal(state.tv.breakEndsAtMs, null);
  }
});

test("Pro Wrestling keeps the full mixed newest-first lineup from all four official channels", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "KIDS01", "history-pro-wrestling", undefined, "Pro Wrestling");
  const beam = new UniversityVideoBeamStore(rooms, () => 900_000);
  const viewer = addMember(rooms, "KIDS01", "viewer");
  beam.joinSlot("KIDS01", viewer.participantId, "viewer");
  const channels = ["All Elite Wrestling", "WWE", "TNA Wrestling", "Ring of Honor Wrestling"];
  const videos = Array.from({ length: 30 }, (_, index) => ({
    videoId: `PW${String(index).padStart(9, "0")}`,
    title: `Official match highlight ${index + 1}`,
    channelTitle: channels[index % channels.length]!,
    description: null,
  }));
  const state = beam.initializeDefaultTvQueue(
    "KIDS01",
    communityDefaultVideoSearch("KIDS01", rooms),
    videos,
  );
  assert.equal(state.tv.queue.length, 30);
  assert.deepEqual(state.tv.queue, videos.map(video => video.videoId));
  assert.deepEqual(new Set(state.tv.videoMetadata.map(video => video.channelTitle)),
    new Set(channels));
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

test("Movies allows mic toggles during playback and starts newly seated users muted", () => {
  let now = 800_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "MOVIES", "history-movies", undefined, "Movies");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const speaker = addMember(rooms, "MOVIES", "speaker");
  beam.joinSlot("MOVIES", speaker.participantId, "speaker");
  const state = beam.initializeDefaultTvQueue("MOVIES", communityDefaultVideoSearch("MOVIES", rooms), [
    { videoId: "movie123456", title: "Feature film", channelTitle: "Licensed Movies", description: null },
  ], { movie123456: 5_000 });
  assert.equal(state.tv.micLockedDuringVideo, false);
  const talking = beam.setSelfMedia("MOVIES", speaker.participantId, "mic", true);
  assert.equal(talking.slots.find(slot => slot.participantId === speaker.participantId)?.micMuted, false);

  now += 5_000;
  const breakState = beam.getState("MOVIES");
  assert.equal(breakState.tv.micLockedDuringVideo, false);
  assert.equal(breakState.tv.breakEndsAtMs, now + 180_000);
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

test("only active seat microphones can subscribe to the room audio conversation", async () => {
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
  assert.equal(claims.video.canSubscribe, false,
    "video-only audience connections cannot subscribe to seat conversation audio");
  assert.equal(claims.video.canPublish, false);
  assert.equal(audience.token.includes(fakeSettings.apiSecret), false);

  const speaker = await service.createToken({
    roomName: "streamtalk-test-room",
    participantId: "00000000-0000-4000-8000-000000000002",
    displayName: "Speaker",
    role: "speaker",
    canSubscribe: true,
  });
  const speakerClaims = JSON.parse(Buffer.from(speaker.token.split(".")[1]!, "base64url").toString("utf8"));
  assert.equal(speakerClaims.video.canPublish, true);
  assert.equal(speakerClaims.video.canSubscribe, true);
  assert.deepEqual(speakerClaims.video.canPublishSources, [],
    "audio beam speaker tokens start with no media sources; server policy grants microphone only after validation");
  assert.equal(speaker.token.includes(fakeSettings.apiSecret), false);

  const policyUpdates: Array<{ sources: TrackSource[]; muted: boolean; canSubscribe: boolean }> = [];
  const policyClient = {
    getParticipant: async () => ({ tracks: [{ source: TrackSource.MICROPHONE, sid: "mic-track" }] }),
    updateParticipant: async (_room: string, _participant: string,
      update: { permission: { canPublish: boolean; canPublishSources: TrackSource[]; canSubscribe: boolean } }) => {
      policyUpdates.push({ sources: update.permission.canPublishSources, muted: false, canSubscribe: update.permission.canSubscribe });
    },
    mutePublishedTrack: async (_room: string, _participant: string, _track: string, muted: boolean) => {
      policyUpdates.at(-1)!.muted = muted;
    },
  };
  const policyService = new LiveKitBeamService(
    () => fakeSettings,
    () => policyClient as unknown as import("livekit-server-sdk").RoomServiceClient,
  );
  await policyService.setSelfTrackEnabled("streamtalk-test-room", "speaker", "mic", false, []);
  await policyService.setSelfTrackEnabled(
    "streamtalk-test-room", "speaker", "mic", true, [TrackSource.MICROPHONE],
  );
  await policyService.applySpeakerMediaPolicy("streamtalk-test-room", "speaker", [], false);
  await policyService.applySpeakerMediaPolicy("streamtalk-test-room", "speaker", [TrackSource.MICROPHONE], true);
  assert.deepEqual(policyUpdates.map(update => update.muted), [true, false, true, false],
    "server-side mic policy disables and enables the publisher track with the toggle");
  assert.deepEqual(policyUpdates[0]?.sources, []);
  assert.deepEqual(policyUpdates[1]?.sources, [TrackSource.MICROPHONE]);
  assert.deepEqual(policyUpdates.slice(0, 2).map(update => update.canSubscribe), [false, true],
    "seat conversation subscription follows the same mic toggle");
  assert.deepEqual(policyUpdates.slice(2).map(update => update.canSubscribe), [false, true]);
});

test("standalone Go Live tokens publish camera and mic only for the host", async () => {
  const fakeSettings: LiveKitSettings = {
    url: "wss://live.example.test", apiKey: "test-public-key", apiSecret: "test-only-secret",
  };
  const service = new LiveKitBeamService(() => fakeSettings);
  const host = await service.createLiveStreamToken({
    roomName: "st-live-test-hash", identity: "host", displayName: "Creator", role: "host",
  });
  const viewer = await service.createLiveStreamToken({
    roomName: "st-live-test-hash", identity: "viewer-test", displayName: "Viewer", role: "viewer",
  });
  const hostClaims = JSON.parse(Buffer.from(host.token.split(".")[1]!, "base64url").toString("utf8"));
  const viewerClaims = JSON.parse(Buffer.from(viewer.token.split(".")[1]!, "base64url").toString("utf8"));
  assert.equal(hostClaims.video.canPublish, true);
  assert.deepEqual(hostClaims.video.canPublishSources.sort(), ["camera", "microphone"]);
  assert.equal(viewerClaims.video.canPublish, false);
  assert.deepEqual(viewerClaims.video.canPublishSources, []);
  assert.equal(viewerClaims.video.canPublishData, true);
  assert.equal(host.token.includes(fakeSettings.apiSecret), false);
});

test("CNN News plays 15-minute live segments, opens the three-minute mic break, then refreshes the queue", () => {
  let now = 9_000_000;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "NEWS01", "history-news", undefined, "News");
  const beam = new UniversityVideoBeamStore(rooms, () => now);
  const defaultSearch = communityDefaultVideoSearch("NEWS01", rooms)!;
  const liveVideoId = "GotlA1KKWoo";
  const fallbackVideoId = "dQw4w9WgXcQ";

  let state = beam.initializeDefaultTvQueue("NEWS01", defaultSearch, [{
    videoId: liveVideoId,
    title: "CNN Headlines: 24/7 Live News",
    channelTitle: "CNN",
    description: null,
  }], { [liveVideoId]: 15 * 60_000 });
  assert.equal(beam.getNextAutomaticPlaybackTransitionAt("NEWS01"), now + 15 * 60_000);

  now += 15 * 60_000;
  state = beam.getState("NEWS01");
  assert.equal(state.tv.breakEndsAtMs, now + 3 * 60_000);
  assert.equal(state.tv.micLockedDuringVideo, false);

  now = state.tv.breakEndsAtMs!;
  state = beam.getState("NEWS01");
  assert.equal(state.tv.currentVideoId, liveVideoId);
  assert.equal(state.tv.micLockedDuringVideo, false);
  assert.equal(state.tv.startedAtMs, now);

  state = beam.refreshAutomaticDefaultTvQueue("NEWS01", defaultSearch, [{
    videoId: fallbackVideoId,
    title: "Latest CNN headlines",
    channelTitle: "CNN",
    description: null,
  }], { [fallbackVideoId]: 60_000 }, liveVideoId, now);
  assert.equal(state.tv.currentVideoId, fallbackVideoId,
    "the official latest-video fallback can replace the stream when it is no longer live");
  assert.equal(beam.getNextAutomaticPlaybackTransitionAt("NEWS01"), now + 60_000);

  const stale = beam.refreshAutomaticDefaultTvQueue("NEWS01", defaultSearch, [{
    videoId: liveVideoId,
    title: "CNN Headlines: 24/7 Live News",
    channelTitle: "CNN",
    description: null,
  }], { [liveVideoId]: 15 * 60_000 }, fallbackVideoId, now - 1);
  assert.equal(stale.tv.currentVideoId, fallbackVideoId,
    "a stale segment refresh cannot overwrite a newer room state");
});
