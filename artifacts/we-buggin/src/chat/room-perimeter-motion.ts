export const ROOM_PERIMETER_DURATION_MS = 12_000;
export const ROOM_PERIMETER_LIGHT_SIZE = 220;

/** Constant-distance keyframes for a rounded screen rim. Calculated on resize,
 * not per frame; the browser animates only a small layer's transform. */
export function roomPerimeterMotionFrames(width: number, height: number): Keyframe[] {
  const inset = 1;
  const radius = Math.min(11, Math.max(0, (Math.min(width, height) - 2) / 2));
  const horizontal = Math.max(0, width - 2 * inset - 2 * radius);
  const vertical = Math.max(0, height - 2 * inset - 2 * radius);
  const arc = Math.PI * radius / 2;
  const total = 2 * horizontal + 2 * vertical + 4 * arc;
  const frames: Keyframe[] = [];
  let distance = 0;
  const add = (x: number, y: number) => frames.push({
    transform: `translate3d(${x - ROOM_PERIMETER_LIGHT_SIZE / 2}px, ${y - ROOM_PERIMETER_LIGHT_SIZE / 2}px, 0)`,
    offset: total ? distance / total : 0,
  });
  const corner = (cx: number, cy: number, start: number) => {
    for (let step = 1; step <= 8; step++) {
      distance += arc / 8;
      const angle = start + step * Math.PI / 16;
      add(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    }
  };
  add(inset + radius, inset);
  distance += horizontal; add(width - inset - radius, inset);
  corner(width - inset - radius, inset + radius, -Math.PI / 2);
  distance += vertical; add(width - inset, height - inset - radius);
  corner(width - inset - radius, height - inset - radius, 0);
  distance += horizontal; add(inset + radius, height - inset);
  corner(inset + radius, height - inset - radius, Math.PI / 2);
  distance += vertical; add(inset, inset + radius);
  corner(inset + radius, inset + radius, Math.PI);
  frames[frames.length - 1]!.offset = 1;
  return frames;
}
