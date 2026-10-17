import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { processGiftStudioClipOnServer } from "./gift-studio";

test("server Gift Studio processor makes a real transparent VP9 WebM from a green-screen clip", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gift-studio-server-test-"));
  const sourcePath = path.join(directory, "sample.mp4");
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x00ff00:s=320x180:r=24:d=6",
      "-vf",
      "drawbox=x=36:y=85:w=245:h=55:color=black:t=fill,drawbox=x=188:y=75:w=70:h=10:color=white:t=fill,drawbox=x=32:y=91:w=280:h=5:color=red:t=fill",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath,
    ]);
    const sourceBytes = (await stat(sourcePath)).size;
    const result = await processGiftStudioClipOnServer({
      sourcePath,
      sourceBytes,
      settings: {
        preset: "green",
        keyColor: "#00ff00",
        tolerance: 0.12,
        softness: 0.06,
        spill: 0.55,
        maxDimension: 480,
      },
    });
    assert.ok(result.bytes > 0);
    const header = await readFile(result.path);
    assert.deepEqual(header.subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const rgba = execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-c:v", "libvpx-vp9", "-i", result.path,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
    ]);
    const backgroundAlpha = rgba[(10 * 320 + 10) * 4 + 3]!;
    const blackAlpha = rgba[(120 * 320 + 50) * 4 + 3]!;
    const whiteAlpha = rgba[(78 * 320 + 200) * 4 + 3]!;
    const redAlpha = rgba[(93 * 320 + 45) * 4 + 3]!;
    assert.ok(backgroundAlpha < 32, `green background should be transparent, got alpha ${backgroundAlpha}`);
    assert.ok(blackAlpha > 200, `black car body should remain visible, got alpha ${blackAlpha}`);
    assert.ok(whiteAlpha > 200, `white highlight should remain visible, got alpha ${whiteAlpha}`);
    assert.ok(redAlpha > 200, `red trail should remain visible, got alpha ${redAlpha}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("server processor removes a #008000 screen without erasing dark, white, or red artwork", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gift-studio-dark-green-test-"));
  const sourcePath = path.join(directory, "dark-green-car.mp4");
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x008000:s=320x180:r=24:d=6",
      "-vf",
      "drawbox=x=0:y=0:w=80:h=180:color=0x006000:t=fill,drawbox=x=240:y=0:w=80:h=180:color=0x00a000:t=fill,drawbox=x=36:y=85:w=245:h=55:color=black:t=fill,drawbox=x=188:y=75:w=70:h=10:color=white:t=fill,drawbox=x=32:y=91:w=280:h=5:color=red:t=fill",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath,
    ]);
    const sourceBytes = (await stat(sourcePath)).size;
    const result = await processGiftStudioClipOnServer({
      sourcePath,
      sourceBytes,
      settings: {
        preset: "green",
        keyColor: "#008000",
        tolerance: 0.12,
        softness: 0.06,
        spill: 0.72,
        maxDimension: 480,
      },
    });
    assert.ok(result.bytes > 0);
    const header = await readFile(result.path);
    assert.deepEqual(header.subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const rgba = execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-c:v", "libvpx-vp9", "-i", result.path,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
    ]);
    const sampleAlpha = (x: number, y: number) => rgba[(y * 320 + x) * 4 + 3]!;
    assert.ok(sampleAlpha(10, 10) < 32, "the darker green shade should be transparent");
    assert.ok(sampleAlpha(300, 10) < 32, "the brighter green shade should be transparent");
    assert.ok(sampleAlpha(50, 120) > 200, "the black car body should remain visible");
    assert.ok(sampleAlpha(200, 78) > 200, "the white highlight should remain visible");
    assert.ok(sampleAlpha(45, 93) > 200, "the red light trail should remain visible");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
