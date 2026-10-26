import assert from "node:assert/strict";
import { test, after } from "node:test";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { pool } from "@workspace/db";
import { cauldronStillFrame } from "./cauldron-still-frame";

test("development: existing upload produces transparent single-frame PNGs, not animated fallback files", {
  skip: process.env.NODE_ENV !== "development",
  timeout: 60_000,
}, async () => {
  const first = cauldronStillFrame(0);
  assert.equal(cauldronStillFrame(0), first, "concurrent zero requests share one extraction");
  const levels = [0, 25, 50, 75, 100];
  const frames = await Promise.all(levels.map(cauldronStillFrame));
  const pinkPixels: number[] = [];
  for (const frame of frames) {
    const metadata = await sharp(frame).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 266);
    assert.equal(metadata.height, 480);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(frame.includes(Buffer.from("acTL")), false, "no APNG animation chunk");
    const { data } = await sharp(frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0, brightPink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent++;
      if (data[i + 3] > 128 && data[i] > 180 && data[i + 1] < 130 && data[i + 2] > 120) brightPink++;
    }
    assert.ok(transparent > 50_000, "transparent surroundings are retained");
    pinkPixels.push(brightPink);
  }
  assert.ok(pinkPixels[0] < pinkPixels[2] && pinkPixels[2] < pinkPixels[4],
    "empty, partial and full visibly differ in liquid fill");
  const directory = "../../generated-artifacts/cauldron-hold";
  await fs.mkdir(directory, { recursive: true });
  await sharp({ create: { width: 266 * 5, height: 480, channels: 4, background: "#151515" } })
    .composite(frames.map((input, index) => ({ input, left: index * 266, top: 0 })))
    .png().toFile(`${directory}/levels-0-25-50-75-100.png`);
});
after(async () => { await pool.end(); });
