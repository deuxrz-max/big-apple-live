import { test } from "node:test";
import assert from "node:assert/strict";
import type { EmojiIdentity } from "@workspace/api-zod";
import type { AudioEvent, AudioPeer } from "@workspace/room-audio";
import { RoomError, RoomStore } from "./room-store";
import { UniversityAudioBeamStore } from "./university-audio-beam";
import { UniversityAudioSignaling } from "./university-audio-signaling";

const identity: EmojiIdentity = {
  emojiId: "1F642", gender: "Male", color: "#F7C531", hairColor: "#111111",
};
function createRoom(store: RoomStore, id: string, historyId: string) {
  store.registerCommunity({ roomId: id, historyId, label: id, createdAt: new Date(0) });
}
function addMember(store: RoomStore, roomId: string, accountId: string) {
  return store.join(roomId, accountId, { accountId, identity });
}
function sink() {
  const events: AudioEvent[] = [];
  let closed = false;
  return {
    events,
    send(event: AudioEvent) { events.push(event); },
    close() { closed = true; },
    get closed() { return closed; },
    self(): AudioPeer {
      const ready = events.find(event => event.type === "audio.ready");
      assert.ok(ready?.type === "audio.ready");
      return ready.data.self;
    },
  };
}

test("university beams have four atomic speaker slots and isolate rooms", async () => {
  const rooms = new RoomStore();
  createRoom(rooms, "LIVEME", "history-live");
  createRoom(rooms, "BIGOLV", "history-bigo");
  const beams = new UniversityAudioBeamStore(rooms);
  const members = Array.from({ length: 6 }, (_, i) => addMember(rooms, "LIVEME", `account-${i}`));
  const attempts = await Promise.allSettled(members.map((member, i) => Promise.resolve().then(() =>
    beams.joinSlot("LIVEME", member.participantId, `account-${i}`))));
  const accepted = attempts.filter((result): result is PromiseFulfilledResult<ReturnType<typeof beams.getState>> =>
    result.status === "fulfilled");
  assert.equal(accepted.length, 4);
  assert.equal(attempts.filter(result => result.status === "rejected").length, 2);
  assert.equal(beams.getState("LIVEME").slots.filter(slot => slot.participantId).length, 4);
  assert.equal(new Set(beams.getState("LIVEME").slots.map(slot => slot.slotNumber)).size, 4);
  assert.equal(beams.getState("LIVEME").hostParticipantId, accepted[0]!.value.hostParticipantId);
  assert.throws(() => beams.joinSlot("LIVEME", members[4]!.participantId, "account-4"),
    (error: unknown) => error instanceof RoomError && error.status === 409);
  assert.equal(beams.getState("BIGOLV").slots.filter(slot => slot.participantId).length, 0);
});

test("host mute blocks transmission until the speaker's own consent; kick frees a slot with a cooldown", () => {
  let now = 100;
  const rooms = new RoomStore(() => now);
  createRoom(rooms, "LIVEME", "history-live");
  const beams = new UniversityAudioBeamStore(rooms, () => now);
  const host = addMember(rooms, "LIVEME", "host-account");
  const speaker = addMember(rooms, "LIVEME", "speaker-account");
  beams.joinSlot("LIVEME", host.participantId, "host-account");
  beams.joinSlot("LIVEME", speaker.participantId, "speaker-account");
  beams.setOwnMicrophone("LIVEME", speaker.participantId, true);
  let state = beams.hostMute("LIVEME", host.participantId, speaker.participantId, true);
  let slot = state.slots.find(item => item.participantId === speaker.participantId)!;
  assert.equal(slot.micEnabled, false);
  assert.equal(slot.mutedByHost, true);
  assert.throws(() => beams.setOwnMicrophone("LIVEME", speaker.participantId, true),
    (error: unknown) => error instanceof RoomError && error.status === 403);
  state = beams.hostMute("LIVEME", host.participantId, speaker.participantId, false);
  slot = state.slots.find(item => item.participantId === speaker.participantId)!;
  assert.equal(slot.mutedByHost, false);
  assert.equal(slot.micEnabled, false, "host cannot turn the speaker's mic back on");
  beams.setOwnMicrophone("LIVEME", speaker.participantId, true);
  assert.equal(beams.getState("LIVEME").slots.find(item => item.participantId === speaker.participantId)!.micEnabled, true);
  assert.throws(() => beams.hostMute("LIVEME", speaker.participantId, host.participantId, true),
    (error: unknown) => error instanceof RoomError && error.status === 403);

  const kicked = beams.kick("LIVEME", host.participantId, speaker.participantId);
  assert.equal(kicked.accountId, "speaker-account");
  assert.equal(rooms.leaveParticipant("LIVEME", speaker.participantId), "speaker-account");
  assert.equal(kicked.state.slots.filter(item => item.participantId).length, 1);
  assert.throws(() => beams.assertCanJoin("LIVEME", "speaker-account"),
    (error: unknown) => error instanceof RoomError && error.status === 409);
  now += 60_001;
  assert.doesNotThrow(() => beams.assertCanJoin("LIVEME", "speaker-account"));
});

test("a disconnected speaker releases its spot and listeners never negotiate a sending SDP", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "LIVEME", "history-live");
  const beams = new UniversityAudioBeamStore(rooms);
  const signaling = new UniversityAudioSignaling(rooms, beams);
  const speaker = addMember(rooms, "LIVEME", "speaker");
  const listener = addMember(rooms, "LIVEME", "listener");
  beams.joinSlot("LIVEME", speaker.participantId, "speaker");
  const speakerSink = sink();
  const listenerSink = sink();
  const disconnectSpeaker = signaling.connect("LIVEME", speaker.participantSessionId, "speaker", speakerSink);
  signaling.connect("LIVEME", listener.participantSessionId, "listener", listenerSink);
  assert.equal(speakerSink.self().role, "speaker");
  assert.equal(listenerSink.self().role, "listener");
  const listenerReady = listenerSink.events.find(event => event.type === "audio.ready");
  assert.ok(listenerReady?.type === "audio.ready");
  assert.deepEqual(listenerReady.data.peers.map(peer => peer.participantId), [speaker.participantId]);
  const speakerReady = speakerSink.events.find(event => event.type === "audio.ready");
  assert.ok(speakerReady?.type === "audio.ready");
  const speakerPeers = speakerSink.events.filter(event => event.type === "audio.peers").at(-1);
  assert.ok(speakerPeers?.type === "audio.peers");
  assert.deepEqual(speakerPeers.data.peers.map(peer => peer.participantId), [listener.participantId]);

  assert.throws(() => signaling.signal("LIVEME", listener.participantSessionId, "listener", {
    sourceConnectionId: listenerSink.self().connectionId,
    targetParticipantId: speaker.participantId,
    targetConnectionId: speakerSink.self().connectionId,
    kind: "description",
    description: { type: listener.participantId < speaker.participantId ? "offer" : "answer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n" },
  }), (error: unknown) => error instanceof RoomError && error.status === 403);
  disconnectSpeaker();
  assert.equal(beams.getState("LIVEME").slots.filter(slot => slot.participantId).length, 0);
  assert.ok(speakerSink.closed);
  assert.ok(listenerSink.events.some(event => event.type === "audio.peers" && event.data.peers.length === 0));
});

test("university audio trickles candidates only between current room connections", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "LIVEME", "history-live");
  createRoom(rooms, "BIGOLV", "history-bigo");
  const beams = new UniversityAudioBeamStore(rooms);
  const signaling = new UniversityAudioSignaling(rooms, beams);
  const speaker = addMember(rooms, "LIVEME", "speaker");
  const listener = addMember(rooms, "LIVEME", "listener");
  const outsider = addMember(rooms, "BIGOLV", "outsider");
  beams.joinSlot("LIVEME", speaker.participantId, "speaker");
  const speakerSink = sink();
  const listenerSink = sink();
  const outsiderSink = sink();
  signaling.connect("LIVEME", speaker.participantSessionId, "speaker", speakerSink);
  signaling.connect("LIVEME", listener.participantSessionId, "listener", listenerSink);
  signaling.connect("BIGOLV", outsider.participantSessionId, "outsider", outsiderSink);

  const candidate = {
    candidate: "candidate:1 1 udp 2130706431 192.0.2.1 5000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
  };
  signaling.signal("LIVEME", speaker.participantSessionId, "speaker", {
    sourceConnectionId: speakerSink.self().connectionId,
    targetParticipantId: listener.participantId,
    targetConnectionId: listenerSink.self().connectionId,
    kind: "candidate",
    candidate,
  });
  assert.ok(listenerSink.events.some(event =>
    event.type === "audio.candidate" &&
    event.data.from.participantId === speaker.participantId &&
    event.data.candidate?.candidate === candidate.candidate));
  assert.equal(outsiderSink.events.some(event => event.type === "audio.candidate"), false);

  assert.throws(() => signaling.signal("LIVEME", speaker.participantSessionId, "speaker", {
    sourceConnectionId: speakerSink.self().connectionId,
    targetParticipantId: listener.participantId,
    targetConnectionId: "00000000-0000-4000-8000-000000000000",
    kind: "candidate",
    candidate: null,
  }), (error: unknown) => error instanceof RoomError && error.status === 409);
  assert.throws(() => signaling.signal("LIVEME", listener.participantSessionId, "listener", {
    sourceConnectionId: listenerSink.self().connectionId,
    targetParticipantId: speaker.participantId,
    targetConnectionId: speakerSink.self().connectionId,
    kind: "description",
    description: {
      type: listener.participantId < speaker.participantId ? "offer" : "answer",
      sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n",
    },
  }), (error: unknown) => error instanceof RoomError && error.status === 403);
});

test("mic permission handoff keeps the slot and lets the speaker-enable action succeed", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "LIVEME", "history-live");
  const beams = new UniversityAudioBeamStore(rooms);
  const signaling = new UniversityAudioSignaling(rooms, beams);
  const member = addMember(rooms, "LIVEME", "member");

  const listenerSink = sink();
  const disconnectListener = signaling.connect(
    "LIVEME", member.participantSessionId, "member", listenerSink,
  );
  assert.equal(listenerSink.self().role, "listener");

  beams.joinSlot("LIVEME", member.participantId, "member");
  assert.equal(beams.getState("LIVEME").slots.some(slot => slot.participantId === member.participantId), true);
  disconnectListener();

  assert.equal(
    beams.getState("LIVEME").slots.some(slot => slot.participantId === member.participantId),
    true,
    "closing the pre-permission listener connection must not release the reserved speaker slot",
  );

  const speakerSink = sink();
  signaling.connect("LIVEME", member.participantSessionId, "member", speakerSink);
  assert.equal(speakerSink.self().role, "speaker");
  assert.equal(beams.getState("LIVEME").slots.some(slot => slot.participantId === member.participantId), true);
  const enabled = beams.setOwnMicrophone("LIVEME", member.participantId, true);
  assert.equal(
    enabled.slots.find(slot => slot.participantId === member.participantId)?.micEnabled,
    true,
    "the post-permission unmute action must still find the reserved speaker slot",
  );
});

test("leaving the university frees the active speaker slot", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "LIVEME", "history-live");
  const beams = new UniversityAudioBeamStore(rooms);
  const signaling = new UniversityAudioSignaling(rooms, beams);
  const speaker = addMember(rooms, "LIVEME", "speaker");
  beams.joinSlot("LIVEME", speaker.participantId, "speaker");
  const speakerSink = sink();
  signaling.connect("LIVEME", speaker.participantSessionId, "speaker", speakerSink);
  rooms.leave("LIVEME", speaker.participantSessionId);
  assert.equal(beams.getState("LIVEME").slots.filter(slot => slot.participantId).length, 0);
  assert.ok(speakerSink.closed);
});

test("leaving the speaker slot keeps the person in the university as an audience member", () => {
  const rooms = new RoomStore();
  createRoom(rooms, "LIVEME", "history-live");
  const beams = new UniversityAudioBeamStore(rooms);
  const audienceMember = addMember(rooms, "LIVEME", "audience-member");
  beams.joinSlot("LIVEME", audienceMember.participantId, "audience-member");
  const state = beams.leaveSlot("LIVEME", audienceMember.participantId);
  assert.equal(state.slots.filter(slot => slot.participantId).length, 0);
  assert.doesNotThrow(() => rooms.requireAccountMember(
    "LIVEME", audienceMember.participantSessionId, "audience-member",
  ));
});
