import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomStore, RoomError, SESSION_TIMEOUT_MS, EMPTY_ROOM_TIMEOUT_MS } from "./room-store";

test("create, join, isolation, and explicit leave keep snapshots current", () => {
  const store = new RoomStore();
  const first = store.create("Creator");
  const second = store.create("Other room");
  const joined = store.join(first.room.roomId.toLowerCase(), "Guest");
  assert.notEqual(first.room.roomId, second.room.roomId);
  assert.equal(joined.room.participants.length, 2);
  assert.equal(store.get(second.room.roomId).participants.length, 1);
  assert.notEqual(joined.participantSessionId, joined.room.participants[1]?.participantId);
  assert.ok(!JSON.stringify(joined.room).includes(joined.participantSessionId));
  store.leave(first.room.roomId, joined.participantSessionId);
  assert.equal(store.get(first.room.roomId).participants.length, 1);
  assert.throws(() => store.heartbeat(first.room.roomId, joined.participantSessionId), RoomError);
});

test("heartbeats preserve active sessions while inactive sessions expire", () => {
  let now = 0;
  const store = new RoomStore(() => now);
  const creator = store.create("Creator");
  store.join(creator.room.roomId, "Inactive");
  now = 30_000;
  store.heartbeat(creator.room.roomId, creator.participantSessionId);
  now = SESSION_TIMEOUT_MS;
  assert.equal(store.get(creator.room.roomId).participants.length, 1);
  now += 30_000;
  store.sweep();
  assert.equal(store.get(creator.room.roomId).participants.length, 0);
  assert.throws(() => store.heartbeat(creator.room.roomId, creator.participantSessionId), RoomError);
});

test("membership changes and expiry notify only the appropriate room subscribers", () => {
  let now = 0;
  const store = new RoomStore(() => now);
  const creator = store.create("Creator");
  const other = store.create("Other");
  const events: string[] = [];
  const unsubscribe = store.subscribe(creator.room.roomId, (event) => events.push(event.type));
  store.join(other.room.roomId, "Unrelated");
  assert.equal(events.length, 0);
  store.join(creator.room.roomId, "Guest");
  assert.deepEqual(events, ["room.snapshot"]);
  now = SESSION_TIMEOUT_MS;
  store.sweep();
  assert.deepEqual(events, ["room.snapshot", "room.snapshot"]);
  now += EMPTY_ROOM_TIMEOUT_MS;
  store.sweep();
  assert.equal(events.at(-1), "room.expired");
  assert.throws(() => store.get(creator.room.roomId), RoomError);
  unsubscribe();
});

test("deactivating a community room redirects its subscribers without deleting stored history", () => {
  const store = new RoomStore();
  store.registerCommunity({
    roomId: "HIDDEN1", historyId: "HIDDEN1-HISTORY", label: "Hidden topic", createdAt: new Date(0),
  });
  store.join("HIDDEN1", "Member");
  const events: string[] = [];
  store.subscribe("HIDDEN1", event => events.push(event.type));

  store.deactivateCommunity("HIDDEN1");

  assert.deepEqual(events, ["room.expired"]);
  assert.equal(store.isCommunity("HIDDEN1"), false);
  assert.throws(() => store.get("HIDDEN1"), RoomError);
});

test("returned snapshots cannot mutate stored membership", () => {
  const store = new RoomStore();
  const creator = store.create("Creator");
  creator.room.participants.pop();
  creator.room.createdAt.setFullYear(1900);
  const current = store.get(creator.room.roomId);
  assert.equal(current.participants.length, 1);
  assert.notEqual(current.createdAt.getFullYear(), 1900);
});

test("unknown rooms and full rooms fail explicitly", () => {
  const store = new RoomStore();
  assert.throws(() => store.join("AAAAAAAAAAAA", "Guest"), RoomError);
  const creator = store.create("Creator");
  for (let i = 1; i < 100; i++) store.join(creator.room.roomId, `Guest ${i}`);
  assert.throws(() => store.join(creator.room.roomId, "Overflow"),
    (error: unknown) => error instanceof RoomError && error.status === 409);
});

test("test-only university rooms never appear in public occupied or follower presence", () => {
  let now = 1_000;
  const store = new RoomStore(() => now);
  const identity = { emojiId: "test", gender: "Male" as const, color: "#FFFFFF", hairColor: "#222222" };
  store.registerCommunity({
    roomId: "DEV-AUDIO-LAB",
    historyId: "DEV-AUDIO-LAB-IN-MEMORY",
    label: "Preview Audio Test Lab",
    createdAt: new Date(now),
    testOnly: true,
  });
  const joined = store.join("DEV-AUDIO-LAB", "Test account", { accountId: "test-account", identity });
  assert.deepEqual(store.occupiedUniversities(), []);
  assert.equal(store.latestUniversityForAccount("test-account"), null);
  store.leave("DEV-AUDIO-LAB", joined.participantSessionId);
  now += 1;
  assert.deepEqual(store.occupiedUniversities(), []);
});

test("community headcount tie timestamp advances only when membership count changes", () => {
  let now = 1_000;
  const store = new RoomStore(() => now);
  store.registerCommunity({
    roomId: "MUSIC",
    historyId: "MUSIC-HISTORY",
    label: "Music",
    createdAt: new Date(now),
  });
  const creator = store.join("MUSIC", "Creator");
  assert.equal(store.communityHeadcountSince("MUSIC"), 1_000);

  now = 2_000;
  const guest = store.join("MUSIC", "Guest");
  assert.equal(store.communityHeadcountSince("MUSIC"), 2_000);

  now = 3_000;
  store.heartbeat("MUSIC", creator.participantSessionId);
  assert.equal(store.communityHeadcountSince("MUSIC"), 2_000);

  now = 4_000;
  store.leave("MUSIC", guest.participantSessionId);
  assert.equal(store.communityHeadcountSince("MUSIC"), 4_000);
});

test("room entrance effects are broadcast once and only replayed while recent", () => {
  let now = 1_000;
  const store = new RoomStore(() => now);
  store.registerCommunity({
    roomId: "MUSIC",
    historyId: "MUSIC-HISTORY",
    label: "Music",
    createdAt: new Date(now),
  });
  const identity = { emojiId: "test", gender: "Male" as const, color: "#FFFFFF", hairColor: "#222222" };
  const owner = store.join("MUSIC", "VAMPSQUAD", { accountId: "owner-account", identity });
  const events: string[] = [];
  store.subscribe("MUSIC", event => events.push(event.type));
  assert.equal(store.hasAccountParticipant("MUSIC", "owner-account"), true);
  const effect = store.publishRoomEntranceEffect("MUSIC", "owner-account", "lion-entrance", 6_066);
  assert.deepEqual(events, ["room.entrance-effect"]);
  assert.equal(effect.displayName, "VAMPSQUAD");
  assert.equal(effect.participantId, owner.participantId);
  assert.equal(store.recentRoomEntranceEffects("MUSIC").length, 1);
  now += 60_001;
  assert.deepEqual(store.recentRoomEntranceEffects("MUSIC"), []);
});