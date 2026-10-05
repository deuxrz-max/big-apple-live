import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomStore } from "./room-store";
import { messageMood, PORTRAIT_IDS, portraitHair, MOOD_SPRITES, type MoodDefinition } from "@workspace/beam-identity";

const identity = {
  emojiId: "1F642", gender: "Male" as const, color: "#F7C531", hairColor: "#111111",
  portraitId: "spiked-smile", currentMood: "smiling" as const,
};
test("Beam capacities remain exact, account resumption uses one seat, and legacy rooms remain 100", () => {
  for (const capacity of [2, 4, 9, 12] as const) {
    const store = new RoomStore();
    const host = store.create("Host", { accountId: "host", identity }, { name: "Beam", capacity });
    assert.equal(host.room.roomId.length, 6);
    assert.equal(host.room.capacity, capacity);
    for (let i = 1; i < capacity; i++) store.join(host.room.roomId, `Person${i}`, { accountId: `person${i}`, identity });
    assert.throws(() => store.join(host.room.roomId, "TooMany", { accountId: "extra", identity }));
    const resumed = store.join(host.room.roomId, "Host", { accountId: "host", identity });
    assert.equal(resumed.participantId, host.participantId);
    assert.equal(resumed.participantSessionId, host.participantSessionId);
    assert.equal(resumed.room.participants.length, capacity);
    store.leave(host.room.roomId, host.participantSessionId);
    assert.equal(store.join(host.room.roomId, "Extra", { accountId: "extra", identity }).room.participants.length, capacity);
  }
  const legacy = new RoomStore().create("Guest");
  assert.equal(legacy.room.capacity, 100);
  assert.equal(legacy.room.roomId.length, 12);
});
test("Account plus private room credential prevents cross-user and cross-room impersonation", () => {
  const store = new RoomStore();
  const a = store.create("A", { accountId: "a", identity });
  const b = store.join(a.room.roomId, "B", { accountId: "b", identity });
  const elsewhere = store.create("A", { accountId: "a", identity });
  assert.equal(store.requireAccountMember(a.room.roomId, a.participantSessionId, "a").participantId, a.participantId);
  assert.throws(() => store.requireAccountMember(a.room.roomId, b.participantSessionId, "a"));
  assert.throws(() => store.requireAccountMember(elsewhere.room.roomId, a.participantSessionId, "a"));
  store.leave(a.room.roomId, a.participantSessionId);
  assert.throws(() => store.requireAccountMember(a.room.roomId, a.participantSessionId, "a"));
  assert.equal(store.get(a.room.roomId).participants[0]!.identity!.portraitId, identity.portraitId);
});
test("Server mood selection keeps missing variants unsupported and last qualifying face wins", () => {
  assert.equal(messageMood("spiked", "🥹"), undefined);
  assert.equal(messageMood("ponytails", "😭"), undefined);
  assert.equal(messageMood("spiked", "🔥👀🤝hello"), undefined);
  assert.equal(messageMood("spiked", "🙂😜")!.portraitId, "spiked-silly-wink");
  assert.equal(messageMood("ponytails", "🤨")!.portraitId, "ponytail-raised-eyebrow");
  assert.equal(messageMood("ponytails", "😉")!.currentMood, "winking");
  assert.equal(messageMood("ponytails", "😜")!.currentMood, "playful_wink");
  assert.equal(messageMood("spiked", "🙂‍↔️"), undefined);
  for (const mood of Object.values(MOOD_SPRITES) as MoodDefinition[]) {
    for (const [hair, id] of Object.entries(mood.portraits)) {
      assert.ok((PORTRAIT_IDS as readonly string[]).includes(id));
      assert.equal(portraitHair(id), hair);
    }
  }
});