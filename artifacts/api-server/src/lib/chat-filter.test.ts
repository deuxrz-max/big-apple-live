import assert from "node:assert/strict";
import test from "node:test";
import { censorChatText } from "./chat-filter";

test("prohibited words are censored inline while surrounding text remains readable", () => {
  assert.equal(censorChatText("Go fuck yourself"), "Go $%<& yourself");
  assert.equal(censorChatText("That was a blowjob."), "That was a $%<&.");
  assert.equal(censorChatText("nigger", ["nigger"]), "$%<&");
  assert.equal(censorChatText("you are worthless", ["you are worthless"]), "you are worthless");
});

test("censor token stays a literal string and ordinary words are not false positives", () => {
  const text = censorChatText("Go fuck yourself");
  assert.equal(text, "Go $%<& yourself");
  assert.ok(text.includes("<") && text.includes("&"));
  for (const ordinary of ["Scunthorpe", "class", "assistant", "hello"]) {
    assert.equal(censorChatText(ordinary), ordinary);
  }
});

test("words inside larger words are not censored", () => {
  assert.equal(censorChatText("classical assistant"), "classical assistant");
  assert.equal(censorChatText("the word shitake"), "the word shitake");
});
