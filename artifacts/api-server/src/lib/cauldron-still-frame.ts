import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { giftStudioMediaFile } from "./gift-studio";
import { CAULDRON_VERSION_ID } from "./system-cauldron-assets";
import { cauldronFrameTime } from "./cauldron-frame-policy";

const execFileAsync = promisify(execFile);
// Derived, disposable PNGs only. Originals remain untouched in App Storage.
const frames = new Map<number, Promise<Buffer>>();
let source: Promise<string> | undefined;
let queue: Promise<void> = Promise.resolve();

async function sourcePath(): Promise<string> {
  if (!source) {
    source = (async () => {
      const { file } = await giftStudioMediaFile({
        versionId: CAULDRON_VERSION_ID, variant: "webm", activeOnly: true,
      });
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) > 10 * 1024 * 1024) throw new Error("Cauldron source exceeds the frame extraction limit.");
      const directory = await fs.mkdtemp(path.join(tmpdir(), "deux-cauldron-still-"));
      const destination = path.join(directory, "source.webm");
      try {
        await file.download({ destination });
        return destination;
      } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
      }
    })().catch(error => { source = undefined; throw error; });
  }
  return source;
}

export function cauldronStillFrame(level: number): Promise<Buffer> {
  const time = cauldronFrameTime(level); // Validate before allocation or storage access.
  const cached = frames.get(level);
  if (cached) return cached;
  // At most one bounded FFmpeg worker, with a finite 101-key cache.
  const pending = queue.then(async () => {
    const input = await sourcePath();
    const { stdout } = await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-v", "error", "-threads", "1", "-c:v", "libvpx-vp9", "-i", input,
      "-ss", time.toFixed(3), "-frames:v", "1", "-vf", "format=rgba",
      "-threads", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1",
    ], { encoding: "buffer", timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    if (!stdout.length) throw new Error("The Cauldron still frame could not be extracted.");
    return stdout;
  });
  frames.set(level, pending);
  queue = pending.then(() => undefined, () => undefined);
  void pending.catch(() => { frames.delete(level); });
  return pending;
}
