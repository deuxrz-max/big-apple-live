import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStoredZip } from "./downloadPngFramesZip";
import { applyKeyToPixels } from "./liveKeyPreview";
import type { ClipSettings } from "./processClip";

const greenSettings: ClipSettings = {
  preset: "green",
  keyColor: "#00ff00",
  tolerance: 0.24,
  softness: 0.08,
  spill: 0.35,
  maxDimension: 720,
};

test("live green key removes the backdrop, keeps the white subject and feathers edges", () => {
  const pixels = new Uint8ClampedArray([
    0, 255, 0, 255,       // pure green screen
    255, 255, 255, 255,   // white car body
    50, 200, 50, 255,     // soft green edge
  ]);
  applyKeyToPixels(pixels, greenSettings);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 255);
  assert.ok(pixels[11]! > 0 && pixels[11]! < 255);
  assert.ok(pixels[9]! < 200, "spill reduction should reduce green tint on the edge");
});

test("black key removes black but retains a mid-gray subject", () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255]);
  applyKeyToPixels(pixels, {
    ...greenSettings,
    preset: "black",
    keyColor: "#000000",
  });
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 255);
});

test("PNG frame archive is a valid ZIP with intact frame bytes", async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const zip = createStoredZip([{ name: "rose/frame-0001.png", bytes: pngBytes }]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "gift-studio-zip-"));
  const zipPath = path.join(dir, "frames.zip");
  try {
    await writeFile(zipPath, Buffer.from(await zip.arrayBuffer()));
    execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
    const extracted = execFileSync("unzip", ["-p", zipPath, "rose/frame-0001.png"]);
    assert.deepEqual(new Uint8Array(extracted), pngBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
