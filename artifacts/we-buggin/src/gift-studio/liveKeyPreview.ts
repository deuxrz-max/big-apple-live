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
  const low = Math.max(0, threshold - feather);
  const high = Math.min(1, threshold + feather);
  const range = Math.max(0.001, high - low);
  const spill = clamp(settings.spill, 0, 1);
  const isGreen = settings.preset === "green" || (keyG > keyR * 1.2 && keyG > keyB * 1.2);
  const isMagenta = settings.preset === "magenta" || (keyR > keyG * 1.2 && keyB > keyG * 1.2);

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const dr = red - keyR;
    const dg = green - keyG;
    const db = blue - keyB;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db) / 441.673;
    const t = clamp((distance - low) / range, 0, 1);
    const matte = t * t * (3 - 2 * t);
    pixels[offset + 3] = Math.round(pixels[offset + 3]! * matte);

    const despill = spill * (1 - matte);
    if (despill > 0.001 && isGreen) {
      const neutral = Math.max(red, blue);
      pixels[offset + 1] = Math.round(green - Math.max(0, green - neutral) * despill);
    } else if (despill > 0.001 && isMagenta) {
      const neutral = Math.max(green, blue);
      pixels[offset] = Math.round(red - Math.max(0, red - neutral) * despill);
    }
  }
}
