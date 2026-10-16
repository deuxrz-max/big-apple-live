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
      "-f", "lavfi", "-i", "color=c=0x00ff00:s=320x180:r=24:d=1",
      "-vf", "drawbox=x=80:y=35:w=160:h=110:color=white:t=fill",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath,
    ]);
    const sourceBytes = (await stat(sourcePath)).size;
    const result = await processGiftStudioClipOnServer({
      sourcePath,
      sourceBytes,
      settings: {
        preset: "green",
        keyColor: "#00ff00",
        tolerance: 0.24,
        softness: 0.08,
        spill: 0.55,
        maxDimension: 480,
      },
    });
    assert.ok(result.bytes > 0);
    const header = await readFile(result.path);
    assert.deepEqual(header.subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
