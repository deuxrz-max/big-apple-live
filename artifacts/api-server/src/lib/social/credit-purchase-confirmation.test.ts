import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db, accountProfiles, socialCreditPurchases, socialLedger, socialSettings, socialWallets } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordConfirmedCreditPurchase } from "./credit-purchase-confirmation";
import { accountBadgeState, saveEquippedBadge } from "./monthly-credit-badges";
import { ledger } from "./rewards";

test("confirmed credit purchases are idempotent and never count a duplicate twice", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const accountId = `monthly-badge-fixture-${suffix}`;
  const username = `Month_${suffix}`;
  const providerPurchaseId = `purchase-${suffix}`;
  t.after(async () => {
    await db.delete(accountProfiles).where(eq(accountProfiles.accountId, accountId));
    await db.$client.end();
  });

  await db.insert(accountProfiles).values({
    accountId,
    username,
    nameKey: username.toLowerCase(),
    emojiId: "1F600",
    gender: "Male",
    color: "#ffffff",
    hairColor: "#000000",
  });

  const first = await recordConfirmedCreditPurchase(accountId, "fixture", providerPurchaseId, 1_000);
  const duplicate = await recordConfirmedCreditPurchase(accountId, "fixture", providerPurchaseId, 1_000);
  assert.equal(first.credited, true);
  assert.equal(duplicate.credited, false);
  assert.equal(first.balance, 1_000);
  assert.equal(duplicate.balance, 1_000);
  assert.equal(first.badgeId, "monthly-tier-1");
  const [settings] = await db.select().from(socialSettings).where(eq(socialSettings.accountId, accountId));
  assert.equal(settings?.equippedBadgeId, "monthly-tier-1", "a newly earned tier equips automatically");
  assert.equal(settings?.badgeEquipPreferenceSet, true);
  assert.equal((await db.select().from(socialCreditPurchases).where(eq(socialCreditPurchases.accountId, accountId))).length, 1);
  assert.equal((await db.select().from(socialLedger).where(eq(socialLedger.accountId, accountId))).length, 1);
  const [purchaseTransaction] = (await ledger(accountId)).transactions;
  assert.equal(purchaseTransaction?.kind, "credit_purchase");
  assert.equal(purchaseTransaction?.delta, 1_000, "a confirmed coin purchase is recorded as coins in");
  assert.equal((await db.select().from(socialWallets).where(eq(socialWallets.accountId, accountId)))[0]?.balance, 1_000);
  await assert.rejects(saveEquippedBadge(accountId, "monthly-tier-5"), /do not have that active badge/i);
  await saveEquippedBadge(accountId, null);
  const unequipped = await accountBadgeState(accountId);
  assert.equal(unequipped.equippedBadgeId, null, "users can explicitly have no badge equipped");
  const [unequippedSettings] = await db.select().from(socialSettings).where(eq(socialSettings.accountId, accountId));
  assert.equal(unequippedSettings?.equippedBadgeId, null);
  assert.equal(unequippedSettings?.badgeEquipPreferenceSet, true);
  await assert.rejects(
    recordConfirmedCreditPurchase(accountId, "fixture", providerPurchaseId, 5_000),
    /already applied to a different purchase/,
  );
});
