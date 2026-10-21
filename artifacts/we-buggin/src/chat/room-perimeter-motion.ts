export const ROOM_PERIMETER_DURATION_MS = 12_000;
export const ROOM_PERIMETER_LIGHT_SIZE = 220;

export type RoomPerimeterEdge = "top" | "right" | "bottom" | "left";

/** Animate one short highlight along a single edge; never animate a viewport-sized mask. */
export function roomPerimeterMotionFrames(
  width: number,
  height: number,
  edge: RoomPerimeterEdge,
): Keyframe[] {
  const horizontal = edge === "top" || edge === "bottom";
  const size = Math.min(ROOM_PERIMETER_LIGHT_SIZE, horizontal ? width : height);
  const x = (value: number) => `translate3d(${value}px, 0, 0)`;
  const y = (value: number) => `translate3d(0, ${value}px, 0)`;
  const hidden = (transform: string, offset: number): Keyframe => ({
    transform, opacity: 0, offset,
  });
  const visible = (transform: string, offset: number): Keyframe => ({
    transform, opacity: 1, offset,
  });

  switch (edge) {
    case "top":
      return [
        hidden(x(-size), 0), hidden(x(-size), .04), visible(x(0), .06),
        visible(x(Math.max(0, width - size)), .20), hidden(x(width), .24),
        hidden(x(width), 1),
      ];
    case "right":
      return [
        hidden(y(-size), 0), hidden(y(-size), .29), visible(y(0), .31),
        visible(y(Math.max(0, height - size)), .45), hidden(y(height), .49),
        hidden(y(height), 1),
      ];
    case "bottom":
      return [
        hidden(x(width), 0), hidden(x(width), .54), visible(x(Math.max(0, width - size)), .56),
        visible(x(0), .70), hidden(x(-size), .74), hidden(x(-size), 1),
      ];
    case "left":
      return [
        hidden(y(height), 0), hidden(y(height), .79), visible(y(Math.max(0, height - size)), .81),
        visible(y(0), .95), hidden(y(-size), .99), hidden(y(-size), 1),
      ];
  }
}
