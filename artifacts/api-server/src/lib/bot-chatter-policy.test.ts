import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseBotChatterLine,
  DEFAULT_BOT_CHATTER_SETTINGS,
  hasRecentHumanRoomActivity,
  nextBotChatterDelayMs,
} from "./bot-chatter-policy";

test("each moderator bot has its own clean 20-30 line pool", () => {
  assert.equal(DEFAULT_BOT_CHATTER_SETTINGS.bots.length, 4);
  for (const bot of DEFAULT_BOT_CHATTER_SETTINGS.bots) {
    assert.ok(bot.personality.length > 0);
    assert.ok(bot.lines.length >= 20 && bot.lines.length <= 30);
    assert.equal(new Set(bot.lines).size, bot.lines.length, `${bot.name} lines should not repeat`);
    assert.ok(bot.lines.every(line => line.split(/\s+/u).length <= 14), `${bot.name} line exceeds 14 words`);
  }
});

test("Rare, Normal and Often delays stay within their configured ranges", () => {
  const low = () => 0;
  const high = () => 1;
  assert.equal(nextBotChatterDelayMs("rare", low), 8 * 60_000);
  assert.ok(nextBotChatterDelayMs("rare", high) < 10 * 60_000);
  assert.equal(nextBotChatterDelayMs("normal", low), 6 * 60_000);
  assert.ok(nextBotChatterDelayMs("normal", high) < 9 * 60_000);
  assert.equal(nextBotChatterDelayMs("often", low), 5 * 60_000);
  assert.ok(nextBotChatterDelayMs("often", high) < 7 * 60_000);
});

test("chatter needs recent real chat after the last bot comment", () => {
  const now = 1_000_000;
  const lastBot = new Date(now - 5_000);
  assert.equal(hasRecentHumanRoomActivity(new Date(now - 1_000), now, lastBot), true);
  assert.equal(hasRecentHumanRoomActivity(new Date(now - 10_000), now, lastBot), false);
  assert.equal(hasRecentHumanRoomActivity(new Date(now - 16 * 60_000), now, null), false);
  assert.equal(hasRecentHumanRoomActivity(null, now, null), false);
});

test("a bot will not repeat the immediately previous line when alternatives exist", () => {
  assert.equal(chooseBotChatterLine(["A", "B", "C"], "B", () => 0), "A");
  assert.equal(chooseBotChatterLine(["Only line"], "Only line", () => 0), "Only line");
  assert.equal(chooseBotChatterLine([], null), null);
});
