import test from "node:test";
import assert from "node:assert/strict";
import {
  mayModerateAnotherAccount, mayModerateAppRunRoom, mayModerateRoom,
} from "./room-moderation-policy";

test("only a room host or an existing moderator can moderate a hosted room", () => {
  assert.equal(mayModerateRoom("host", "host", false), true);
  assert.equal(mayModerateRoom("host", "moderator", true), true);
  assert.equal(mayModerateRoom("host", "member", false), false);
});

test("ownerless app-run rooms are moderated only by existing moderators", () => {
  assert.equal(mayModerateAppRunRoom(true), true);
  assert.equal(mayModerateAppRunRoom(false), false);
});

test("moderation cannot target the acting account", () => {
  assert.equal(mayModerateAnotherAccount("moderator", "member"), true);
  assert.equal(mayModerateAnotherAccount("moderator", "moderator"), false);
});
