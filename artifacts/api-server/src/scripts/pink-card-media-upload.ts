import { readFile } from "node:fs/promises";
import { pinkRewardMediaFile, PINK_MEDIA, type PinkMediaVariant } from "../lib/pink-card-media";
if (process.env.NODE_ENV !== "development") throw new Error("Development media setup only");
const directory = process.argv[2];
if (!directory) throw new Error("Pass the processed output directory");
for (const variant of Object.keys(PINK_MEDIA) as PinkMediaVariant[]) {
  const item = PINK_MEDIA[variant];
  await pinkRewardMediaFile(variant).save(await readFile(`${directory}/${item.filename}`), {
    resumable: false, metadata: { contentType: item.type, cacheControl: "public, max-age=3600" },
  });
  process.stdout.write(`Stored ${item.filename}\n`);
}
