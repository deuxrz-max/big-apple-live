/** Read-only inventory/download of active Gift Studio animations for sizing QA.
 * No catalog writes, sends, wallet calls or media replacements.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, giftStudioAssets, socialGiftCatalogSettings, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { giftStudioMediaFile } from "../lib/gift-studio";

const out = path.resolve("generated-artifacts/gift-sizing-audit");
await mkdir(out, { recursive: true });
try {
  const rows = await db.select({
    id: giftStudioAssets.id, giftId: giftStudioAssets.giftId,
    settings: giftStudioAssets.settings, durationMs: giftStudioAssets.durationMs,
    catalogStatus: socialGiftCatalogSettings.status,
    productType: socialGiftCatalogSettings.productType,
  }).from(giftStudioAssets)
    .leftJoin(socialGiftCatalogSettings, eq(socialGiftCatalogSettings.giftId, giftStudioAssets.giftId))
    .where(eq(giftStudioAssets.status, "active"));
  const inventory = [];
  for (const row of rows) {
    const filename = `${row.id}.webm`;
    const { file } = await giftStudioMediaFile({ versionId: row.id, variant: "webm", activeOnly: true });
    await file.download({ destination: path.join(out, filename) });
    inventory.push({
      versionId: row.id, giftId: row.giftId, name: row.settings.draftName ?? row.giftId,
      backgroundMode: row.settings.backgroundMode ?? "see-through",
      durationMs: row.durationMs, catalogStatus: row.catalogStatus, productType: row.productType, filename,
    });
    console.log(`Downloaded for inspection: ${row.settings.draftName ?? row.giftId}`);
  }
  await writeFile(path.join(out, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
} finally { await pool.end(); }
