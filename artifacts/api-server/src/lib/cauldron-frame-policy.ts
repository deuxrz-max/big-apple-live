/** Visual calibration of the existing 6.042-second upload, never reward/target logic. */
const FILL_ANCHORS = [[0, 0], [25, 1], [50, 2.2], [75, 3.3], [100, 5.5]] as const;

export function cauldronFrameTime(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > 100) throw new Error("Invalid cauldron display level.");
  if (level === 0) return 0; // Exact first frame: glass container, no liquid.
  for (let index = 1; index < FILL_ANCHORS.length; index++) {
    const [upperLevel, upperTime] = FILL_ANCHORS[index];
    const [lowerLevel, lowerTime] = FILL_ANCHORS[index - 1];
    if (level <= upperLevel) {
      return lowerTime + (upperTime - lowerTime) * (level - lowerLevel) / (upperLevel - lowerLevel);
    }
  }
  return 5.5;
}
