import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isBeamMicEnabled,
  setBeamTvSoundMuted,
  shouldSubscribeToBeamAudio,
  type BeamTvSoundPlayer,
} from "../src/chat/beam-audio-policy";

const slots = [
  { participantId: "speaker-a", micMuted: false, mutedByHost: false },
  { participantId: "speaker-b", micMuted: true, mutedByHost: false },
  { participantId: "speaker-c", micMuted: false, mutedByHost: true },
];

test("room seats never capture or display camera video and refuse legacy video subscriptions", () => {
  const hook = readFileSync("src/chat/useUniversityVideoBeam.ts", "utf8");
  const view = readFileSync("src/chat/UniversityRoom.tsx", "utf8");
  assert.match(hook, /createLocalTracks\(\{[\s\S]*?video: false/);
  assert.doesNotMatch(hook, /setCameraEnabled|createLocalVideoTrack/);
  assert.match(hook, /publication\.kind === Track\.Kind\.Video[\s\S]*?publication\.setSubscribed\(false\)/);
  assert.match(view, /Nine audio-only seats/);
  assert.match(view, /ur-slot-photo-fill/);
  assert.match(view, /is-speaking/);
  assert.doesNotMatch(view, /BeamVideoTrack|<video[\s>]/);
});

test("only mic-on seated listeners receive another mic-on seat's audio", () => {
  assert.equal(isBeamMicEnabled(slots[0]), true);
  const activeSlots = slots.map(slot => slot.participantId === "speaker-b"
    ? { ...slot, micMuted: false }
    : slot);
  assert.equal(shouldSubscribeToBeamAudio({
    listenerId: "speaker-a",
    listenerMicEnabled: true,
    publisherId: "speaker-b",
    slots: activeSlots,
  }), true);
  assert.equal(shouldSubscribeToBeamAudio({
    listenerId: "speaker-a",
    listenerMicEnabled: false,
    publisherId: "speaker-a",
    slots,
  }), false, "a seated mic-off listener stays out of the conversation");
  assert.equal(shouldSubscribeToBeamAudio({
    listenerId: "video-only-listener",
    listenerMicEnabled: false,
    publisherId: "speaker-a",
    slots,
  }), false, "a non-seat video listener cannot subscribe");
  assert.equal(shouldSubscribeToBeamAudio({
    listenerId: "speaker-a",
    listenerMicEnabled: true,
    publisherId: "speaker-a",
    slots,
  }), false, "the local mic is not played back to its owner");
  assert.equal(shouldSubscribeToBeamAudio({
    listenerId: "speaker-a",
    listenerMicEnabled: true,
    publisherId: "speaker-c",
    slots,
  }), false, "a host-muted publisher is excluded");
});

test("the mic audio split only changes local video sound, never playback controls", () => {
  const calls: string[] = [];
  let currentTime = 42;
  const player: BeamTvSoundPlayer & {
    pause(): void;
    playVideo(): void;
    loadVideoById(): void;
    getCurrentTime(): number;
  } = {
    mute: () => calls.push("mute"),
    unMute: () => calls.push("unMute"),
    setVolume: volume => calls.push(`volume:${volume}`),
    pause: () => calls.push("pause"),
    playVideo: () => calls.push("play"),
    loadVideoById: () => calls.push("load"),
    getCurrentTime: () => currentTime,
  };

  setBeamTvSoundMuted(player, true);
  assert.deepEqual(calls, ["mute", "volume:0"]);
  currentTime = 43;
  calls.length = 0;

  setBeamTvSoundMuted(player, false);
  assert.deepEqual(calls, ["unMute", "volume:100"]);
  assert.equal(player.getCurrentTime(), 43, "sound restoration keeps the ongoing playback position");
  assert.doesNotMatch(calls.join(","), /pause|play|load/);
});
