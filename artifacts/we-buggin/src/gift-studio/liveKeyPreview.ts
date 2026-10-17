import type { ClipSettings } from "./processClip";

const PREVIEW_MAX_DIMENSION = 480;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function fitFrameToBox(
  frameWidth: number,
  frameHeight: number,
  boxWidth: number,
  boxHeight: number,
) {
  if (![frameWidth, frameHeight, boxWidth, boxHeight].every(Number.isFinite)
    || frameWidth <= 0 || frameHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return null;
  }
  const scale = Math.min(boxWidth / frameWidth, boxHeight / frameHeight);
  return {
    width: Math.round(frameWidth * scale),
    height: Math.round(frameHeight * scale),
  };
}

function colorChannels(hex: string) {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ] as const;
}

function rgbToHsv(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  let hue = 0;
  if (chroma > 0) {
    if (max === r) hue = 60 * (((g - b) / chroma) % 6);
    else if (max === g) hue = 60 * ((b - r) / chroma + 2);
    else hue = 60 * ((r - g) / chroma + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : chroma / max, value: max };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function classifyKeyColor(hex: string): "green" | "magenta" | "blue" | "custom" {
  const hsv = rgbToHsv(...colorChannels(hex));
  if (hsv.saturation < 0.18) return "custom";
  if (hsv.hue >= 75 && hsv.hue <= 170) return "green";
  if (hsv.hue >= 265 && hsv.hue <= 335) return "magenta";
  if (hsv.hue >= 190 && hsv.hue <= 265) return "blue";
  return "custom";
}

/**
 * Finds the most common chromatic color on the outside edge of one or more
 * decoded frames. Quantization absorbs normal video compression noise.
 */
export function detectDominantEdgeColor(frames: ImageData[]): string | null {
  const bins = new Map<string, { count: number; red: number; green: number; blue: number }>();
  for (const frame of frames) {
    const { width, height, data } = frame;
    if (!width || !height) continue;
    const borderX = Math.max(1, Math.ceil(width * 0.08));
    const borderY = Math.max(1, Math.ceil(height * 0.08));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= borderX && x < width - borderX && y >= borderY && y < height - borderY) continue;
        const offset = (y * width + x) * 4;
        if (data[offset + 3]! < 200) continue;
        const red = data[offset]!;
        const green = data[offset + 1]!;
        const blue = data[offset + 2]!;
        const hsv = rgbToHsv(red, green, blue);
        if (hsv.saturation < 0.18 || hsv.value < 0.06) continue;
        const key = `${red >> 4},${green >> 4},${blue >> 4}`;
        const current = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
        current.count++;
        current.red += red;
        current.green += green;
        current.blue += blue;
        bins.set(key, current);
      }
    }
  }
  const mostCommon = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!mostCommon || mostCommon.count < 8) return null;
  return rgbToHex(
    mostCommon.red / mostCommon.count,
    mostCommon.green / mostCommon.count,
    mostCommon.blue / mostCommon.count,
  );
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.015) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      video.removeEventListener("seeked", finish);
      reject(new Error("The clip could not be sampled for automatic color detection."));
    }, 2500);
    const finish = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish, { once: true });
    video.currentTime = time;
  });
}

export async function detectVideoEdgeColor(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) return null;
  const scale = Math.min(1, 192 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(2, Math.floor(video.videoWidth * scale));
  const height = Math.max(2, Math.floor(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const wasPlaying = !video.paused;
  const previousTime = video.currentTime;
  const frameTimes = [0, Math.min(0.18, video.duration * 0.08), Math.min(0.42, video.duration * 0.2)];
  const frames: ImageData[] = [];
  try {
    video.pause();
    for (const time of [...new Set(frameTimes)]) {
      await waitForSeek(video, Math.max(0, time));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue;
      context.drawImage(video, 0, 0, width, height);
      frames.push(context.getImageData(0, 0, width, height));
    }
    return detectDominantEdgeColor(frames);
  } finally {
    try {
      await waitForSeek(video, Math.max(0, Math.min(previousTime, Math.max(0, video.duration - 0.02))));
    } catch {
      // Keep the source preview usable even if a browser refuses a seek restore.
    }
    if (wasPlaying) void video.play().catch(() => undefined);
  }
}

export function sampleVideoColorAtPoint(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
  box: DOMRect,
): string | null {
  if (!video.videoWidth || !video.videoHeight || box.width <= 0 || box.height <= 0) return null;
  const display = fitFrameToBox(video.videoWidth, video.videoHeight, box.width, box.height);
  if (!display) return null;
  const left = box.left + (box.width - display.width) / 2;
  const top = box.top + (box.height - display.height) / 2;
  const x = (clientX - left) / display.width;
  const y = (clientY - top) / display.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(2, Math.floor(video.videoWidth * scale));
  const height = Math.max(2, Math.floor(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  const pixel = context.getImageData(
    Math.min(width - 1, Math.floor(x * width)),
    Math.min(height - 1, Math.floor(y * height)),
    1,
    1,
  ).data;
  return rgbToHex(pixel[0]!, pixel[1]!, pixel[2]!);
}

/**
 * Creates an FFmpeg alpha mask using hue and chroma, not raw RGB distance.
 * This makes the same green screen key work across darker and brighter shades
 * while leaving low-chroma black/white details and differently-hued artwork.
 */
export function buildHueChromaKeyFilter(settings: ClipSettings): string {
  const [red, green, blue] = colorChannels(settings.keyColor);
  const key = rgbToHsv(red, green, blue);
  if (settings.preset === "black" || key.saturation < 0.18) {
    const color = settings.keyColor.replace("#", "0x");
    return `format=yuva420p,chromakey=${color}:${clamp(settings.tolerance, 0.02, 0.65).toFixed(3)}:${clamp(settings.softness, 0, 0.5).toFixed(3)}`;
  }

  const r = "r(X,Y)";
  const g = "g(X,Y)";
  const b = "b(X,Y)";
  const max = `max(${r},max(${g},${b}))`;
  const min = `min(${r},min(${g},${b}))`;
  const chroma = `(${max}-${min})`;
  const safeChroma = `max(${chroma},1)`;
  const hue = `if(gt(${chroma},1),if(eq(${max},${r}),60*mod((${g}-${b})/${safeChroma}+6,6),if(eq(${max},${g}),60*((${b}-${r})/${safeChroma}+2),60*((${r}-${g})/${safeChroma}+4))),0)`;
  const rawHueDistance = `abs(${hue}-${key.hue.toFixed(2)})`;
  const hueDistance = `min(${rawHueDistance},360-${rawHueDistance})`;
  const saturation = `${chroma}/max(${max},1)`;
  const distance = `max(${hueDistance},max(abs(${saturation}-${key.saturation.toFixed(4)})*80,abs(${max}/255-${key.value.toFixed(4)})*18))`;
  const low = Math.max(0, settings.tolerance * 80 - settings.softness * 45);
  const high = Math.min(88, settings.tolerance * 80 + settings.softness * 45);
  const t = `clip((${distance}-${low.toFixed(2)})/${Math.max(1, high - low).toFixed(2)},0,1)`;
  const matte = `(${t})*(${t})*(3-2*(${t}))`;
  const keyedMatte = `if(gt(${saturation},${Math.max(0.12, key.saturation * 0.2).toFixed(4)}),${matte},1)`;
  return `format=rgba,geq=r='r(X,Y)':a='alpha(X,Y)*${keyedMatte}',format=yuva420p`;
}

/**
 * Draws a quick, local canvas approximation of the export key so owners can
 * tune the settings before spending time on the full transparent encode.
 */
export function drawKeyedPreview(
  source: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  settings: ClipSettings,
) {
  if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !source.videoWidth || !source.videoHeight) return;
  const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(source.videoWidth, source.videoHeight));
  const width = Math.max(2, Math.floor(source.videoWidth * scale));
  const height = Math.max(2, Math.floor(source.videoHeight * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const stage = canvas.parentElement?.getBoundingClientRect();
  if (stage?.width && stage.height) {
    const displaySize = fitFrameToBox(width, height, stage.width, stage.height);
    if (displaySize) {
      const displayWidth = `${displaySize.width}px`;
      const displayHeight = `${displaySize.height}px`;
      if (canvas.style.width !== displayWidth) canvas.style.width = displayWidth;
      if (canvas.style.height !== displayHeight) canvas.style.height = displayHeight;
    }
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not start the live cutout preview.");
  context.drawImage(source, 0, 0, width, height);
  const frame = context.getImageData(0, 0, width, height);
  applyKeyToPixels(frame.data, settings);
  context.putImageData(frame, 0, 0);
}

export function applyKeyToPixels(pixels: Uint8ClampedArray, settings: ClipSettings) {
  const [keyR, keyG, keyB] = colorChannels(settings.keyColor);
  const threshold = clamp(settings.tolerance, 0.02, 0.65);
  const feather = clamp(settings.softness, 0, 0.5);
  const keyHsv = rgbToHsv(keyR, keyG, keyB);
  const low = Math.max(0, threshold * 80 - feather * 45);
  const high = Math.min(88, threshold * 80 + feather * 45);
  const range = Math.max(1, high - low);
  const spill = clamp(settings.spill, 0, 1);
  const family = settings.preset === "black" ? "black" : classifyKeyColor(settings.keyColor);

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const pixelHsv = rgbToHsv(red, green, blue);
    let matte = 1;
    if (family === "black") {
      const distance = Math.sqrt(red * red + green * green + blue * blue) / 441.673;
      const blackLow = Math.max(0, threshold - feather);
      const blackHigh = Math.min(1, threshold + feather);
      const t = clamp((distance - blackLow) / Math.max(0.001, blackHigh - blackLow), 0, 1);
      matte = t * t * (3 - 2 * t);
    } else if (pixelHsv.saturation >= Math.max(0.12, keyHsv.saturation * 0.2)) {
      const rawHueDistance = Math.abs(pixelHsv.hue - keyHsv.hue);
      const hueDistance = Math.min(rawHueDistance, 360 - rawHueDistance);
      const chromaDistance = Math.abs(pixelHsv.saturation - keyHsv.saturation) * 80;
      const valueDistance = Math.abs(pixelHsv.value - keyHsv.value) * 18;
      const distance = Math.sqrt(hueDistance * hueDistance + chromaDistance * chromaDistance + valueDistance * valueDistance);
      const t = clamp((distance - low) / range, 0, 1);
      matte = t * t * (3 - 2 * t);
    }
    pixels[offset + 3] = Math.round(pixels[offset + 3]! * matte);

    const despill = spill * (1 - matte);
    if (despill > 0.001 && family === "green") {
      const neutral = Math.max(red, blue);
      pixels[offset + 1] = Math.round(green - Math.max(0, green - neutral) * despill);
    } else if (despill > 0.001 && family === "blue") {
      const neutral = Math.max(red, green);
      pixels[offset + 2] = Math.round(blue - Math.max(0, blue - neutral) * despill);
    } else if (despill > 0.001 && family === "magenta") {
      pixels[offset] = Math.round(red - Math.max(0, red - green) * despill);
      pixels[offset + 2] = Math.round(blue - Math.max(0, blue - green) * despill);
    }
  }
}
