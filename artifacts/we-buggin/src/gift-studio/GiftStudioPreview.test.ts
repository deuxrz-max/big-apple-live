import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStoredZip } from "./downloadPngFramesZip";
import {
  analyzeVideoBackgroundFrames,
  applyKeyToPixels,
  classifyKeyColor,
  detectDominantEdgeColor,
  fitFrameToBox,
} from "./liveKeyPreview";
import type { ClipSettings } from "./processClip";

const greenSettings: ClipSettings = {
  backgroundMode: "see-through",
  preserveSourceAlpha: false,
  retainOpaqueBackground: false,
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

test("automatic edge sampling finds a compressed dark-green screen color", () => {
  const width = 20;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const isCenter = x > 2 && x < width - 3 && y > 2 && y < height - 3;
      const color = isCenter ? [18, 20, 21] : [0, 126 + ((x + y) % 4), 0];
      data.set([...color, 255], offset);
    }
  }
  const frame = { width, height, data } as ImageData;
  const color = detectDominantEdgeColor([frame, frame]);
  assert.ok(color);
  assert.equal(classifyKeyColor(color), "green");
  const channels = [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
  assert.ok(channels[1]! >= 124 && channels[1]! <= 130);
});

test("background auto-detection prefers real alpha over black pixels", () => {
  const frames = Array.from({ length: 3 }, () => {
    const width = 24;
    const height = 18;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const subject = x >= 8 && x < 16 && y >= 5 && y < 13;
        data.set(subject ? [240, 240, 240, 255] : [0, 0, 0, 0], offset);
      }
    }
    return { width, height, data } as ImageData;
  });
  assert.deepEqual(analyzeVideoBackgroundFrames(frames), {
    hasTransparency: true,
    mostlyBlack: false,
    edgeColor: null,
  });
});

test("background auto-detection recognizes a black matte across sampled frames", () => {
  const frames = Array.from({ length: 3 }, () => {
    const width = 24;
    const height = 18;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) data.set([0, 0, 0, 255], offset);
    for (let y = 6; y < 12; y++) {
      for (let x = 9; x < 15; x++) data.set([255, 180, 12, 255], (y * width + x) * 4);
    }
    return { width, height, data } as ImageData;
  });
  assert.deepEqual(analyzeVideoBackgroundFrames(frames), {
    hasTransparency: false,
    mostlyBlack: true,
    edgeColor: null,
  });
});

test("background auto-detection leaves scenery on see-through mode", () => {
  const frames = Array.from({ length: 3 }, (_, frameIndex) => {
    const width = 24;
    const height = 18;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const color = x < 8 ? [35 + frameIndex * 8, 110, 155] : x >= 16 ? [110, 125, 65] : [90, 90, 90];
        data.set([...color, 255], offset);
      }
    }
    return { width, height, data } as ImageData;
  });
  const result = analyzeVideoBackgroundFrames(frames);
  assert.equal(result.hasTransparency, false);
  assert.equal(result.mostlyBlack, false);
});

test("auto-detection classifies decoded transparent, black-backed, and scenery clips", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gift-studio-background-detect-"));
  const transparentPath = path.join(directory, "transparent.webm");
  const blackPath = path.join(directory, "black.mp4");
  const sceneryPath = path.join(directory, "scenery.mp4");
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  const createClip = (source: string, filter: string, encoder: string[]) => execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", source,
    "-vf", filter, "-an", ...encoder,
  ]);
  const decodeFrames = (sourcePath: string, decoder?: string) => {
    const bytes = execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      ...(decoder ? ["-c:v", decoder] : []), "-i", sourcePath,
      "-vf", "fps=1,scale=96:54:flags=neighbor,format=rgba", "-frames:v", "3",
      "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
    ]);
    const width = 96;
    const height = 54;
    const frameBytes = width * height * 4;
    return Array.from({ length: Math.floor(bytes.length / frameBytes) }, (_, index) => ({
      width,
      height,
      data: new Uint8ClampedArray(bytes.subarray(index * frameBytes, (index + 1) * frameBytes)),
    } as ImageData));
  };
  try {
    createClip(
      "color=c=black@0.0:s=320x180:r=12:d=3,format=rgba",
      "drawbox=x=100:y=50:w=80:h=80:color=white:t=fill:replace=1",
      ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", "20", transparentPath],
    );
    createClip(
      "color=c=black:s=320x180:r=12:d=3",
      "drawbox=x=100:y=50:w=80:h=80:color=0xffc020:t=fill",
      ["-c:v", "libx264", "-pix_fmt", "yuv420p", blackPath],
    );
    createClip(
      "color=c=0x347899:s=320x180:r=12:d=3",
      "drawbox=x=0:y=0:w=320:h=20:color=0x78a14e:t=fill",
      ["-c:v", "libx264", "-pix_fmt", "yuv420p", sceneryPath],
    );

    const transparent = analyzeVideoBackgroundFrames(decodeFrames(transparentPath, "libvpx-vp9"));
    const black = analyzeVideoBackgroundFrames(decodeFrames(blackPath));
    const scenery = analyzeVideoBackgroundFrames(decodeFrames(sceneryPath));
    assert.equal(transparent.hasTransparency, true, JSON.stringify(transparent));
    assert.equal(transparent.mostlyBlack, false, JSON.stringify(transparent));
    assert.equal(black.hasTransparency, false, JSON.stringify(black));
    assert.equal(black.mostlyBlack, true, JSON.stringify(black));
    assert.equal(scenery.hasTransparency, false, JSON.stringify(scenery));
    assert.equal(scenery.mostlyBlack, false, JSON.stringify(scenery));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hue/chroma key clears darker and brighter green while protecting black, white and red", () => {
  for (const keyColor of ["#008000", "#00ff00"]) {
    const pixels = new Uint8ClampedArray([
      0, 128, 0, 255,        // dark green screen
      0, 96, 0, 255,         // darker green lighting
      0, 160, 0, 255,        // lighter green lighting
      0, 255, 0, 255,        // bright green screen
      4, 5, 4, 255,          // black car body / tire
      245, 245, 245, 255,    // white highlight
      240, 8, 10, 255,       // red light trail
    ]);
    applyKeyToPixels(pixels, { ...greenSettings, keyColor, tolerance: .36, softness: .12 });
    assert.equal(pixels[3], 0, `${keyColor} sample should clear dark green`);
    assert.equal(pixels[7], 0, `${keyColor} sample should clear darker-lit green`);
    assert.equal(pixels[11], 0, `${keyColor} sample should clear lighter-lit green`);
    assert.equal(pixels[15], 0, `${keyColor} sample should clear bright green`);
    assert.ok(pixels[19]! > 240, "black body stays opaque");
    assert.ok(pixels[23]! > 240, "white highlight stays opaque");
    assert.ok(pixels[27]! > 240, "red tail light stays opaque");
  }
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

test("live cutout keeps the full landscape frame inside the preview box", () => {
  const fit = fitFrameToBox(1920, 1080, 346, 194);
  assert.deepEqual(fit, { width: 345, height: 194 });
});

test("live cutout keeps the full portrait frame inside the same preview box", () => {
  const fit = fitFrameToBox(720, 1280, 346, 194);
  assert.deepEqual(fit, { width: 109, height: 194 });
});

test("invalid frame or box sizes do not produce a misleading preview size", () => {
  assert.equal(fitFrameToBox(0, 1080, 346, 194), null);
  assert.equal(fitFrameToBox(1920, 1080, 0, 194), null);
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
