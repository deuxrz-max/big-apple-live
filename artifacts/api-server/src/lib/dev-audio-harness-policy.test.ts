import assert from "node:assert/strict";
import test from "node:test";
import { devAudioHarnessEnabled, mayDriveDevAudioAccount } from "./dev-audio-harness-policy";

test("audio harness is enabled only in development", () => {
  assert.equal(devAudioHarnessEnabled("development"), true);
  assert.equal(devAudioHarnessEnabled("test"), false);
  assert.equal(devAudioHarnessEnabled("production"), false);
  assert.equal(devAudioHarnessEnabled(undefined), false);
});

test("audio harness can drive only explicitly marked test accounts", () => {
  assert.equal(mayDriveDevAudioAccount({ isTestAccount: true }), true);
  assert.equal(mayDriveDevAudioAccount({ isTestAccount: false }), false);
  assert.equal(mayDriveDevAudioAccount(null), false);
  assert.equal(mayDriveDevAudioAccount(undefined), false);
});
