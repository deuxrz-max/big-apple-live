import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claimGiftStudioProcessingSession,
  discardGiftStudioProcessingSession,
  releaseGiftStudioProcessingSession,
  retainGiftStudioProcessingSession,
} from "./gift-studio-processing-sessions";

test("temporary processed clips are owner-bound, single-claim, retryable and cleaned after save", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gift-studio-session-test-"));
  try {
    const token = retainGiftStudioProcessingSession({
      ownerId: "owner-account",
      directory,
      sourcePath: path.join(directory, "source.mp4"),
      sourceName: "source.mp4",
      sourceBytes: 120,
      processedPath: path.join(directory, "processed.webm"),
      processedBytes: 140,
      settings: {
        preset: "green",
        keyColor: "#00ff00",
        tolerance: 0.24,
        softness: 0.08,
        spill: 0.55,
        maxDimension: 480,
      },
    });
    assert.equal(claimGiftStudioProcessingSession("another-account", token), null);
    const claimed = claimGiftStudioProcessingSession("owner-account", token);
    assert.ok(claimed);
    assert.equal(claimGiftStudioProcessingSession("owner-account", token), null);
    releaseGiftStudioProcessingSession(token);
    assert.ok(claimGiftStudioProcessingSession("owner-account", token));
    await discardGiftStudioProcessingSession(token);
    await assert.rejects(stat(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
