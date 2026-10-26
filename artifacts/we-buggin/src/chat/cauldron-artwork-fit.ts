export type ArtworkBounds = { x: number; y: number; width: number; height: number };

/** Ignore near-transparent codec noise, not any visible part of the artwork. */
export function cauldronArtworkBounds(pixels: Uint8ClampedArray, width: number, height: number): ArtworkBounds | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] <= 8) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function cauldronArtworkFit(width: number, height: number, bounds: ArtworkBounds, boxWidth: number, boxHeight: number) {
  const originalScale = Math.min(boxWidth / width, boxHeight / height);
  const scale = Math.min(originalScale * 2, boxWidth / bounds.width, boxHeight / bounds.height);
  return {
    width: width * scale, height: height * scale,
    left: (boxWidth - bounds.width * scale) / 2 - bounds.x * scale,
    top: (boxHeight - bounds.height * scale) / 2 - bounds.y * scale,
  };
}
