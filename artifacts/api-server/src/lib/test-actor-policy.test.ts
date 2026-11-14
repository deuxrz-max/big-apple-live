import test from "node:test";
import assert from "node:assert/strict";
import { mayReceiveTestDm, parseTestActorCommand, testActorControlEnabled } from "./test-actor-policy";

test("test actor control is enabled only in development", () => {
  assert.equal(testActorControlEnabled("development"), true);
  assert.equal(testActorControlEnabled("production"), false);
  assert.equal(testActorControlEnabled(undefined), false);
});

test("only join, leave, chat, direct message and list commands are accepted", () => {
  assert.notEqual(parseTestActorCommand({ action: "join", as: "TestBigo1", room: "LiveMe" }), null);
  assert.notEqual(parseTestActorCommand({ action: "leave", as: "TestBigo1", room: "LiveMe" }), null);
  assert.notEqual(parseTestActorCommand({ action: "chat", as: "TestBigo1", room: "LiveMe", text: "hello" }), null);
  assert.notEqual(parseTestActorCommand({ action: "dm", as: "TestBigo1", to: "Vampsquad", text: "hello" }), null);
  assert.notEqual(parseTestActorCommand({ action: "list" }), null);
  assert.equal(parseTestActorCommand({ action: "chat", as: "TestBigo1", room: "LiveMe", text: "" }), null);
  assert.equal(parseTestActorCommand({ action: "dm", as: "TestBigo1", to: "Vampsquad", text: "hello", extra: true }), null);
  assert.equal(parseTestActorCommand({ action: "unsupported" }), null);
});

test("test DMs are limited to test accounts and the confirmed owner", () => {
  assert.equal(mayReceiveTestDm({ username: "TestBigo2", isTestAccount: true }), true);
  assert.equal(mayReceiveTestDm({ username: "Vampsquad", isTestAccount: false }), true);
  assert.equal(mayReceiveTestDm({ username: "OrdinaryMember", isTestAccount: false }), false);
});
