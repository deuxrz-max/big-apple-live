import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BOT_ACCOUNTS, BOT_VISIT_MS, BotRotation, publicViolation } from "./bot-policy";
import { RoomStore } from "./room-store";

test("four distinct system identities; one minute visits, 45-second breaks and no simultaneous visits", () => {
  assert.equal(new Set(BOT_ACCOUNTS.map(b => b.id)).size, 4);
  assert.ok(BOT_ACCOUNTS.every(bot => bot.arrival === `${bot.name} has arrived`));
  const rotation = new BotRotation(0, () => 0);
  const first = rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], 0);
  assert.equal(first[0]!.type, "join");
  assert.equal(first[0]!.roomId, "LIVEME");
  rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], 15_000);
  rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], 30_000);
  rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], 45_000);
  const leave = rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], BOT_VISIT_MS);
  assert.ok(leave.some(e => e.type === "leave" && e.bot.id === "ghost"));
  assert.equal(rotation.people("LIVEME").length, 0);
  assert.equal(rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], 104_999)
    .some(e => e.bot.id === "ghost"), false);
  const returned = rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], 105_000)
    .find(e => e.bot.id === "ghost" && e.type === "join");
  assert.ok(returned);
  assert.notEqual(returned.roomId, "LIVEME");
  for (let now = 106_000; now < 600_000; now += 1000) {
    rotation.tick(["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"], now);
    for (const room of ["LIVEME", "BIGOLV", "BIGOLV2", "TIKTOK", "SUPRLV"])
      assert.ok(rotation.people(room).length <= 1);
  }
});
test("no empty-room visits; numbered overflow rooms are eligible; random selection is used", () => {
  const rotation = new BotRotation(0, () => .99);
  assert.deepEqual(rotation.tick([], 0), []);
  const joined = rotation.tick(["LIVEME", "BIGOLV2"], 5000);
  assert.equal(joined[0]!.roomId, "BIGOLV2");
});
test("moderator-edited bot names update the visible visitor without resetting its room", () => {
  const rotation = new BotRotation(0, () => 0);
  rotation.tick(["LIVEME"], 0);
  rotation.setDisplayNames({ ghost: "Night Ghost" });
  assert.equal(rotation.people("LIVEME")[0]?.name, "Night Ghost");
  assert.equal(rotation.people("LIVEME")[0]?.arrival, "Night Ghost has arrived");
  const leave = rotation.tick(["LIVEME"], BOT_VISIT_MS).find(event => event.bot.id === "ghost");
  assert.equal(leave?.bot.departure, "Night Ghost slips quietly away.");
});
test("a bot never consumes an audience session in an unlimited public room", () => {
  const store = new RoomStore(() => 0);
  store.registerCommunity({ roomId: "FULL", historyId: randomUUID(), label: "Bigo Live 2", createdAt: new Date() });
  const identity = { emojiId: "neutral", gender: "Male" as const, color: "#000000", hairColor: "#000000" };
  for (let n = 0; n < 32; n++)
    store.join("FULL", `Member ${n}`, { accountId: `member-${n}`, identity });
  const rotation = new BotRotation(0, () => 0);
  rotation.tick(store.occupiedUniversities(), 0);
  assert.equal(rotation.people("FULL").length, 1);
  assert.equal(store.get("FULL").participants.length, 32);
  assert.equal(store.hasUniversitySeat("FULL", "member-32"), true);
  assert.equal(store.hasUniversitySeat("FULL", "member-0"), true);
  assert.equal(store.join("FULL", "Extra", { accountId: "member-32", identity }).room.participants.length, 33);
  assert.equal(store.latestUniversityForAccount("ghost"), null);
});
test("editable words/phrases use normalized word boundaries, not innocent substrings", () => {
  const words = ["ass", "kill yourself", "badword"];
  assert.equal(publicViolation("a classic class assignment", words, [], 0), null);
  assert.equal(publicViolation("KILL...YOURSELF", words, [], 0), "Banned word or phrase");
  assert.equal(publicViolation("ＢＡＤＷＯＲＤ", words, [], 0), "Banned word or phrase");
  assert.equal(publicViolation("bad\u200Bword", words, [], 0), "Banned word or phrase");
  assert.equal(publicViolation("friendly chat", words, [], 0), null);
  assert.equal(publicViolation("badword", [], [], 0), null);
});
test("obvious link repetition and flooding are filtered; old messages expire", () => {
  const now = 100_000;
  assert.equal(publicViolation("https://x.test https://x.test https://x.test", [], [], now), "Repeated links");
  const recent = Array.from({ length: 2 }, () => ({ text: "https://x.test", createdAt: new Date(now - 1000) }));
  assert.equal(publicViolation("https://x.test", [], recent, now), "Repeated links");
  assert.equal(publicViolation("hello", [], Array.from({ length: 5 }, () => ({ text: "hi", createdAt: new Date(now - 1000) })), now), "Flooding");
  assert.equal(publicViolation("hello", [], Array.from({ length: 5 }, () => ({ text: "hi", createdAt: new Date(now - 40_000) })), now), null);
});
