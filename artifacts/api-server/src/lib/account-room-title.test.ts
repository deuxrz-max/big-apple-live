import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAccountRoomTitle } from "./account-room-title";

test("account room titles trim surrounding whitespace and keep one word", () => {
  assert.deepEqual(normalizeAccountRoomTitle("Gold"), { ok: true, name: "Gold" });
  assert.deepEqual(normalizeAccountRoomTitle("  Gold  "), { ok: true, name: "Gold" });
  assert.deepEqual(normalizeAccountRoomTitle("\tGold\n"), { ok: true, name: "Gold" });
});

test("account room titles reject internal spaces, tabs, and line breaks", () => {
  for (const value of ["Gold Room", "Gold\tRoom", "Gold\nRoom", "Gold\r\nRoom"]) {
    assert.deepEqual(normalizeAccountRoomTitle(value), {
      ok: false,
      message: "Use a single word only; Ave is added automatically.",
    });
  }
});

test("account room titles must be nonempty and fit the existing name limit", () => {
  assert.deepEqual(normalizeAccountRoomTitle(" \n\t "), {
    ok: false,
    message: "Enter a one-word room name. Ave is added automatically.",
  });
  assert.deepEqual(normalizeAccountRoomTitle("A".repeat(33)), {
    ok: false,
    message: "Room names must be 32 characters or fewer.",
  });
});
