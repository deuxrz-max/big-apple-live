/** One-off artwork import. Validates all 52 files before uploading any bytes. */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import sharp from "sharp";
import { cardDeckFile } from "./card-deck-media";
import { CARD_DECK_FILENAMES } from "./card-deck-manifest";

const source = resolve("../../attached_assets");
const files = await readdir(source);
const inputs = await Promise.all(CARD_DECK_FILENAMES.map(async filename => {
  const stem = filename.slice(0, -4);
  const matches = files.filter(file => file === filename || new RegExp(`^${stem}_\\d+\\.png$`).test(file));
  if (matches.length !== 1) throw new Error(`${filename}: expected one upload, found ${matches.length}`);
  const bytes = await readFile(resolve(source, matches[0]!));
  const image = sharp(bytes);
  const meta = await image.metadata();
  if (meta.format !== "png" || !meta.width || !meta.height) throw new Error(`Invalid PNG: ${filename}`);
  await image.raw().toBuffer(); // Decode the full image, not just its header.
  return { filename, bytes, hasAlpha: meta.hasAlpha ?? false };
}));
for (const input of inputs) {
  const file = cardDeckFile(input.filename);
  await file.save(input.bytes, { resumable: false, contentType: "image/png" });
  const [stored] = await file.download();
  if (!stored.equals(input.bytes)) throw new Error(`Storage verification failed: ${input.filename}`);
}
console.log(JSON.stringify({
  loaded: inputs.length, storageVerified: inputs.length,
  alphaChannel: inputs.filter(input => input.hasAlpha).length,
  manifestHash: createHash("sha256").update(Buffer.concat(inputs.map(input => input.bytes))).digest("hex"),
}));
