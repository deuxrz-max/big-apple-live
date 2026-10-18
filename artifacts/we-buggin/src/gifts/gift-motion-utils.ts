import type { DeveloperGiftMotionPreset } from "@workspace/api-client-react";

export type GiftMotionCategory = DeveloperGiftMotionPreset["category"];

export function guessGiftMotionCategory(
  filename: string,
  dimensions: [number, number, number],
  nodeNames: string[] = [],
): GiftMotionCategory {
  const text = `${filename} ${nodeNames.join(" ")}`.toLowerCase();
  if (/\b(car|vehicle|truck|bike|motor|wheel|race|drift|auto)\b/.test(text)) return "vehicle";
  if (/\b(character|person|human|robot|creature|animal|avatar|walk|rig)\b/.test(text)) return "character";
  if (/\b(logo|wordmark|badge|brand|title)\b/.test(text)) return "logo";
  const sorted = [...dimensions].map((value) => Math.max(value, 0.0001)).sort((a, b) => b - a);
  const [longest = 1, middle = 1, shortest = 1] = sorted;
  if (shortest / longest < 0.08 && longest / middle < 2.5) return "logo";
  if (dimensions[1] > dimensions[0] * 1.15 && dimensions[1] > dimensions[2] * 1.15) return "character";
  if (dimensions[0] > dimensions[1] * 1.55 && dimensions[2] > dimensions[1] * 0.35) return "vehicle";
  return "object";
}

const entries: DeveloperGiftMotionPreset["entry"][] = ["left", "right", "top", "bottom", "depth"];
const exits: DeveloperGiftMotionPreset["exit"][] = ["left", "right", "top", "bottom", "depth"];
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const randomChoice = <T,>(values: T[]) => values[Math.floor(Math.random() * values.length)]!;

export function createRandomGiftMotion(
  category: GiftMotionCategory,
  animationCount: number,
): DeveloperGiftMotionPreset {
  const entry = randomChoice(entries);
  const exit = randomChoice(exits.filter((direction) => direction !== entry));
  const vehicle = category === "vehicle";
  const character = category === "character";
  return {
    version: 1,
    durationMs: 6000,
    category,
    entry,
    exit,
    speed: randomBetween(0.78, 1.28),
    spin: vehicle
      ? [0, randomBetween(-6.1, 6.1), randomBetween(-0.3, 0.3)]
      : [randomBetween(-1.4, 1.4), randomBetween(-3.1, 3.1), randomBetween(-0.65, 0.65)],
    drift: randomBetween(0.28, 0.92),
    bounce: character ? randomBetween(0.5, 0.95) : randomBetween(0.12, 0.55),
    cameraYaw: randomBetween(-0.78, 0.78),
    cameraPitch: randomBetween(-0.42, 0.42),
    animationIndex: animationCount > 0 ? Math.floor(Math.random() * animationCount) : null,
  };
}
