type ZipEntry = { name: string; nameBytes: Uint8Array; bytes: Uint8Array; crc: number; offset: number };
type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

const encoder = new TextEncoder();
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}
function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function join(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function localDosDate(date: Date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function blobBytes(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

async function waitForFrame(video: FrameCallbackVideo) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function seekTo(video: FrameCallbackVideo, time: number) {
  if (Math.abs(video.currentTime - time) < 0.002 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForFrame(video);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error("A frame could not be decoded for the PNG download."));
    }, 8000);
    const onSeeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = time;
  });
}

function makeZip(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const directoryParts: Uint8Array[] = [];
  let offset = 0;
  const { time, day } = localDosDate(new Date());

  for (const entry of entries) {
    entry.offset = offset;
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20);
    u16(localView, 6, 0x0800);
    u16(localView, 8, 0);
    u16(localView, 10, time);
    u16(localView, 12, day);
    u32(localView, 14, entry.crc);
    u32(localView, 18, entry.bytes.byteLength);
    u32(localView, 22, entry.bytes.byteLength);
    u16(localView, 26, entry.nameBytes.byteLength);
    u16(localView, 28, 0);
    localParts.push(local, entry.nameBytes, entry.bytes);
    offset += local.byteLength + entry.nameBytes.byteLength + entry.bytes.byteLength;

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20);
    u16(centralView, 6, 20);
    u16(centralView, 8, 0x0800);
    u16(centralView, 10, 0);
    u16(centralView, 12, time);
    u16(centralView, 14, day);
    u32(centralView, 16, entry.crc);
    u32(centralView, 20, entry.bytes.byteLength);
    u32(centralView, 24, entry.bytes.byteLength);
    u16(centralView, 28, entry.nameBytes.byteLength);
    u16(centralView, 30, 0);
    u16(centralView, 32, 0);
    u16(centralView, 34, 0);
    u16(centralView, 36, 0);
    u32(centralView, 38, 0);
    u32(centralView, 42, entry.offset);
    directoryParts.push(central, entry.nameBytes);
  }

  const directory = join(directoryParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 4, 0);
  u16(endView, 6, 0);
  u16(endView, 8, entries.length);
  u16(endView, 10, entries.length);
  u32(endView, 12, directory.byteLength);
  u32(endView, 16, offset);
  u16(endView, 20, 0);
  const bytes = join([...localParts, directory, end]);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" });
}

export function createStoredZip(entries: { name: string; bytes: Uint8Array }[]) {
  return makeZip(entries.map(({ name, bytes }) => ({
    name,
    nameBytes: encoder.encode(name),
    bytes,
    crc: crc32(bytes),
    offset: 0,
  })));
}

export async function createTransparentPngFramesZip(
  videoUrl: string,
  filePrefix: string,
  onProgress: (progress: number) => void = () => undefined,
) {
  const video = document.createElement("video") as FrameCallbackVideo;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  try {
    video.load();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("The processed animation did not open for PNG export.")), 15000);
      video.addEventListener("loadedmetadata", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      video.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("This browser could not decode the transparent animation for PNG export."));
      }, { once: true });
    });
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve();
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("The processed animation frame could not be decoded.")), { once: true });
    });

    const fps = 12;
    const duration = Math.max(0, video.duration);
    const frameCount = Math.max(1, Math.ceil(duration * fps));
    if (frameCount > 240) throw new Error("This clip has too many frames for a phone ZIP. Download the WebM instead.");
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) throw new Error("This browser could not create the PNG frames.");

    const entries: ZipEntry[] = [];
    let totalBytes = 0;
    for (let index = 0; index < frameCount; index++) {
      await seekTo(video, Math.min(index / fps, Math.max(0, duration - 0.001)));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("A transparent PNG frame could not be created.")), "image/png");
      });
      const name = `${filePrefix}/frame-${String(index + 1).padStart(4, "0")}.png`;
      const bytes = await blobBytes(blob);
      totalBytes += bytes.byteLength;
      if (totalBytes > 100 * 1024 * 1024) {
        throw new Error("The PNG frame ZIP would be too large for this phone. Download the WebM instead.");
      }
      entries.push({ name, nameBytes: encoder.encode(name), bytes, crc: crc32(bytes), offset: 0 });
      onProgress((index + 1) / frameCount);
    }
    return makeZip(entries);
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}
