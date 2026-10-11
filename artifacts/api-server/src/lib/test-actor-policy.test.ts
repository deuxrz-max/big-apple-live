import test from "node:test";
import assert from "node:assert/strict";
import {
  isTestGiftPair, mayReceiveTestDm, parseTestActorCommand, testActorControlEnabled,
} from "./test-actor-policy";

test("test actor control is enabled only in development", () => {
  assert.equal(testActorControlEnabled("development"), true);
  assert.equal(testActorControlEnabled("production"), false);
  assert.equal(testActorControlEnabled(undefined), false);
});

test("the command contract rejects unmarked-action fields and invalid payloads", () => {
  assert.notEqual(parseTestActorCommand({ action: "join", as: "TestBigo1", room: "LiveMe" }), null);
  assert.notEqual(parseTestActorCommand({ action: "cleanup-preview" }), null);
  assert.notEqual(parseTestActorCommand({ action: "cleanup-delete", confirmation: "a".repeat(64) }), null);
  assert.equal(parseTestActorCommand({ action: "cleanup-delete", confirmation: "short" }), null);
  assert.equal(parseTestActorCommand({ action: "cleanup-delete", confirmation: "a".repeat(64), all: true }), null);
  assert.notEqual(parseTestActorCommand({ action: "join", as: "Vampsquad", room: "LiveMe" }), null);
  assert.notEqual(parseTestActorCommand({ action: "gift", as: "TestBigo1", to: "TestBigo2", room: "LiveMe", gift: "heart" }), null);
  assert.notEqual(parseTestActorCommand({ action: "gift", as: "TestBigo1", to: "TestBigo2", room: "LiveMe", gift: "cosmic-encore" }), null);
  assert.equal(parseTestActorCommand({ action: "gift", as: "TestBigo1", to: "TestBigo2", room: "LiveMe", gift: "moonfox", creditAmount: 500 }), null);
  assert.equal(parseTestActorCommand({ action: "chat", as: "TestBigo1", room: "LiveMe", text: "" }), null);
  assert.equal(parseTestActorCommand({ action: "dm", as: "TestBigo1", to: "Vampsquad", text: "hello", extra: true }), null);
});

test("test DMs are limited to test accounts and the confirmed owner", () => {
  assert.equal(mayReceiveTestDm({ username: "TestBigo2", isTestAccount: true }), true);
  assert.equal(mayReceiveTestDm({ username: "Vampsquad", isTestAccount: false }), true);
  assert.equal(mayReceiveTestDm({ username: "OrdinaryMember", isTestAccount: false }), false);
});

test("test-credit gifts cannot debit or credit a real account", () => {
  assert.equal(isTestGiftPair(true, true), true);
  assert.equal(isTestGiftPair(true, false), false);
  assert.equal(isTestGiftPair(false, true), false);
  assert.equal(isTestGiftPair(false, false), false);
});
