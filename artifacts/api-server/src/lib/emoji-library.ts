import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { RoomError } from "./room-store";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("openmoji/package.json"));
type Entry = { hexcode: string; annotation: string; group: string; emoji: string };
const entries: Entry[] = JSON.parse(readFileSync(join(root, "data/openmoji.json"), "utf8"));
export const emojiCatalog = [...new Map(entries.map((e) => [
  e.hexcode, { id: e.hexcode, name: e.annotation, group: e.group, unicode: e.emoji },
])).values()];
const ids = new Set(emojiCatalog.map((e) => e.id));

export function validateEmojiId(id: string): void {
  if (!ids.has(id)) throw new RoomError(400, "Choose an emoji from the library");
}

/** Trusted library assets only; no user SVG/markup is accepted. */
export function coloredEmoji(id: string, color: string): string {
  if (!ids.has(id)) throw new RoomError(404, "Emoji not found");
  if (!/^[0-9a-fA-F]{6}$/.test(color)) throw new RoomError(400, "Invalid emoji color");
  const svg = readFileSync(join(root, "color/svg", `${id}.svg`), "utf8");
  const neutral = new Set(["#000", "#000000", "#fff", "#ffffff"]);
  const hasColor = [...svg.matchAll(/fill="(#[0-9a-fA-F]{3,6})"/g)]
    .some((m) => !neutral.has(m[1]!.toLowerCase()));
  return svg.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g, (all, attribute: string, value: string) => {
    // Preserve facial lines/teeth while tinting chromatic fills. Monochrome
    // symbols get a tint too so color freedom is meaningful for the full library.
    if (hasColor && (attribute === "stroke" || neutral.has(value.toLowerCase()))) return all;
    return `${attribute}="#${color}"`;
  });
}