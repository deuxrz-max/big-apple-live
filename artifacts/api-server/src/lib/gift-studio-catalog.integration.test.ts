import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { accountProfiles, db, giftStudioAssets, socialGiftCatalogSettings, socialWallets } from "@workspace/db";
import {
  createGiftStudioVersion,
  deleteGiftStudioVersion,
  giftStudioIconFile,
  getActiveGiftStudioMedia,
  overrideGiftStudioIcon,
  regenerateGiftStudioIcon,
  setGiftStudioVersionActive,
  updateGiftCatalogItem,
} from "./gift-studio";
import { giftCatalogWithActiveNames, listGiftCatalogForOwner } from "./gift-studio-catalog";
import { gift } from "./social/rewards";

const execFileAsync = promisify(execFile);

test("development catalog: create, replace, rename, icon alpha, and deactivate without duplicates", {
  skip: process.env.NODE_ENV !== "development",
  timeout: 240_000,
}, async () => {
  let [owner] = await db.select({ accountId: accountProfiles.accountId, username: accountProfiles.username })
    .from(accountProfiles).where(sql`lower(${accountProfiles.username}) = 'vampsquad'`).limit(1);
  if (!owner) {
    [owner] = await db.select({ accountId: accountProfiles.accountId, username: accountProfiles.username })
      .from(accountProfiles).limit(1);
  }
  if (!owner) {
    assert.fail("The development owner profile is not available for this integration check.");
  }

  const temp = await mkdtemp(path.join(tmpdir(), "gift-catalog-integration-"));
  const sourcePath = path.join(temp, "source.mp4");
  const replacementPath = path.join(temp, "replacement.mp4");
  const webmPath = path.join(temp, "transparent.webm");
  const replacementWebmPath = path.join(temp, "replacement-transparent.webm");
  const createdVersionIds: string[] = [];
  let giftId = "";
  const makeSource = async (output: string, color: string) => {
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=green:s=160x120:r=12:d=2`,
      "-vf", `drawbox=x=52:y=30:w=56:h=60:color=${color}:t=fill`,
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", output,
    ], { timeout: 30_000 });
  };
  const makeTransparentWebm = async (output: string) => {
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=160x120:r=12:d=2,format=rgba",
      "-vf", "geq=r='255':g='0':b='0':a='if(between(X,52,108)*between(Y,30,90),255,0)',format=yuva420p",
      "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
      "-b:v", "0", "-crf", "30", output,
    ], { timeout: 30_000 });
  };
  const settings = (draftName: string) => ({
    preset: "green" as const, keyColor: "#00ff00", tolerance: 0.12, softness: 0.08,
    spill: 0.35, maxDimension: 480 as const, draftName, productType: "gift" as const,
  });

  try {
    await makeSource(sourcePath, "red");
    await makeSource(replacementPath, "blue");
    await makeTransparentWebm(webmPath);
    await makeTransparentWebm(replacementWebmPath);

    const first = await createGiftStudioVersion({
      ownerId: owner.accountId, giftId: null, productType: "gift", catalogCost: 37,
      settings: settings("Catalog Icon Test"),
      originalPath: sourcePath, originalName: "source.mp4", originalBytes: (await stat(sourcePath)).size,
      processedWebmPath: webmPath, processedWebmBytes: (await stat(webmPath)).size,
    });
    createdVersionIds.push(first.id);
    await setGiftStudioVersionActive(owner.accountId, first.id, true, { productType: "gift", cost: 37 });
    giftId = `studio-${first.id}`;
    assert.match(giftId, /^studio-/);

    const activeAfterCreate = (await giftCatalogWithActiveNames()).find((gift) => gift.id === giftId);
    assert.equal(activeAfterCreate?.name, "Catalog Icon Test");
    assert.equal(activeAfterCreate?.cost, 37);
    assert.equal(activeAfterCreate?.iconStatus, "transparent");
    assert.match(activeAfterCreate?.iconUrl ?? "", /\/api\/social\/gift-studio\/icons\//);

    const activeAsset = (await db.select({ id: giftStudioAssets.id }).from(giftStudioAssets)
      .where(and(eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active"))).limit(1))[0];
    assert.ok(activeAsset);
    const icon = await giftStudioIconFile({ versionId: activeAsset.id, activeOnly: true });
    const iconPath = path.join(temp, "downloaded-icon.png");
    await icon.file.download({ destination: iconPath });
    const { data: alphaPixels, info } = await sharp(await readFile(iconPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparentPixels = 0;
    for (let offset = 3; offset < alphaPixels.length; offset += info.channels) if (alphaPixels[offset]! < 32) transparentPixels++;
    assert.ok(transparentPixels > 0, "the automatically generated icon should contain real alpha");
    const manualIcon = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: Buffer.from('<svg width="64" height="64"><circle cx="32" cy="32" r="23" fill="#e63c83"/></svg>') }]).png().toBuffer();
    assert.equal((await overrideGiftStudioIcon(owner.accountId, giftId, manualIcon)).iconStatus, "manual-transparent");
    assert.equal((await regenerateGiftStudioIcon(owner.accountId, giftId)).iconStatus, "transparent");

    const replacement = await createGiftStudioVersion({
      ownerId: owner.accountId, giftId, productType: "gift",
      settings: settings("Replacement Clip"),
      originalPath: replacementPath, originalName: "replacement.mp4", originalBytes: (await stat(replacementPath)).size,
      processedWebmPath: replacementWebmPath, processedWebmBytes: (await stat(replacementWebmPath)).size,
    });
    createdVersionIds.push(replacement.id);
    assert.equal(replacement.status, "active");
    const catalogAfterReplace = await giftCatalogWithActiveNames();
    assert.equal(catalogAfterReplace.filter((gift) => gift.id === giftId).length, 1, "replacement must update the same catalog ID");
    assert.equal(catalogAfterReplace.find((gift) => gift.id === giftId)?.name, "Replacement Clip");
    const activeMedia = await getActiveGiftStudioMedia(giftId);
    assert.equal(activeMedia.media?.versionId, replacement.id);
    assert.notEqual(activeAfterCreate?.iconUrl, catalogAfterReplace.find((gift) => gift.id === giftId)?.iconUrl);

    await updateGiftCatalogItem({ giftId, name: "Edited Test Gift" });
    const afterRename = (await giftCatalogWithActiveNames()).find((gift) => gift.id === giftId);
    assert.equal(afterRename?.name, "Edited Test Gift");
    assert.equal(afterRename?.cost, 37, "renaming must preserve catalog price");
    assert.equal((await listGiftCatalogForOwner()).filter((gift) => gift.id === giftId).length, 1);

    await updateGiftCatalogItem({ giftId, status: "inactive" });
    assert.equal((await giftCatalogWithActiveNames()).some((gift) => gift.id === giftId), false);
    assert.equal((await listGiftCatalogForOwner()).find((gift) => gift.id === giftId)?.status, "inactive");

    await updateGiftCatalogItem({ giftId, status: "active" });
    const activeAssetForDelete = (await db.select({ id: giftStudioAssets.id }).from(giftStudioAssets)
      .where(and(eq(giftStudioAssets.giftId, giftId), eq(giftStudioAssets.status, "active"))).limit(1))[0];
    assert.ok(activeAssetForDelete);
    const [walletBeforeDelete] = await db.select({
      balance: socialWallets.balance,
      sent: socialWallets.sent,
      received: socialWallets.received,
    }).from(socialWallets).where(eq(socialWallets.accountId, owner.accountId)).limit(1);

    await updateGiftCatalogItem({ giftId, status: "deleted" });
    assert.equal((await giftCatalogWithActiveNames()).some((gift) => gift.id === giftId), false,
      "deleted gifts must disappear from the sendable room catalog");
    const deletedCatalogEntry = (await listGiftCatalogForOwner()).find((gift) => gift.id === giftId);
    assert.equal(deletedCatalogEntry?.status, "deleted");
    assert.equal(deletedCatalogEntry?.iconUrl, null, "a deleted gift must not expose its generated icon");
    await assert.rejects(
      gift(owner.accountId, owner.username, giftId, crypto.randomUUID()),
      (error: unknown) => error instanceof Error && error.message.includes("This gift isn't available right now."),
      "a stale client send must be rejected before any wallet debit",
    );
    const [walletAfterDelete] = await db.select({
      balance: socialWallets.balance,
      sent: socialWallets.sent,
      received: socialWallets.received,
    }).from(socialWallets).where(eq(socialWallets.accountId, owner.accountId)).limit(1);
    assert.deepEqual(walletAfterDelete, walletBeforeDelete, "a rejected deleted-gift send must not change coin balances");
    await assert.rejects(
      giftStudioIconFile({ versionId: activeAssetForDelete.id, ownerId: owner.accountId }),
      /Gift icon not found/,
      "deleted gifts must not serve or regenerate their old icon",
    );

    await updateGiftCatalogItem({ giftId, status: "active" });
    const restoredCatalogEntry = (await giftCatalogWithActiveNames()).find((gift) => gift.id === giftId);
    assert.ok(restoredCatalogEntry?.iconUrl, "reactivating a gift restores its catalog entry");
    const restoredIcon = await giftStudioIconFile({ versionId: activeAssetForDelete.id, activeOnly: true });
    assert.ok(restoredIcon.file, "the icon can be regenerated after an explicit restore");
  } finally {
    for (const versionId of createdVersionIds.reverse()) {
      await deleteGiftStudioVersion(owner.accountId, versionId).catch(() => {});
    }
    if (giftId) {
      await db.delete(socialGiftCatalogSettings).where(eq(socialGiftCatalogSettings.giftId, giftId)).catch(() => {});
      const [remainingSettings] = await db.select({ giftId: socialGiftCatalogSettings.giftId })
        .from(socialGiftCatalogSettings).where(eq(socialGiftCatalogSettings.giftId, giftId)).limit(1);
      const [remainingAssets] = await db.select({ id: giftStudioAssets.id }).from(giftStudioAssets)
        .where(eq(giftStudioAssets.giftId, giftId)).limit(1);
      assert.equal(remainingSettings, undefined, "temporary catalog settings must be removed after the test");
      assert.equal(remainingAssets, undefined, "temporary animation versions must be removed after the test");
    }
    await rm(temp, { recursive: true, force: true });
  }
});
