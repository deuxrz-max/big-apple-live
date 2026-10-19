import assert from "node:assert/strict";
import test from "node:test";
import { selectFeaturedRoom } from "./directory-utils";

test("Featured is empty when no room has current users", () => {
  assert.equal(selectFeaturedRoom([
    { roomId: "MUSIC", headcount: 0, headcountSince: 100 },
    { roomId: "MOVIES", headcount: 0, headcountSince: 200 },
  ]), undefined);
});

test("Featured selects the sole room with the highest headcount", () => {
  const rooms = [
    { roomId: "MUSIC", headcount: 4, headcountSince: 100 },
    { roomId: "MOVIES", headcount: 2, headcountSince: 90 },
    { roomId: "SPORTS", headcount: 0, headcountSince: 10 },
  ];
  assert.equal(selectFeaturedRoom(rooms)?.roomId, "MUSIC");
});

test("equal highest counts go to the room that reached its current count first", () => {
  const rooms = [
    { roomId: "MOVIES", headcount: 3, headcountSince: 200 },
    { roomId: "MUSIC", headcount: 3, headcountSince: 100 },
    { roomId: "SPORTS", headcount: 1, headcountSince: 50 },
  ];
  assert.equal(selectFeaturedRoom(rooms)?.roomId, "MUSIC");
});
