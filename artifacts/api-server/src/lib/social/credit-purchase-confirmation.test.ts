import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db, accountProfiles, socialCreditPurchases, socialLedger, socialWallets } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordConfirmedCreditPurchase } from "./credit-purchase-confirmation";

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
  assert.equal((await db.select().from(socialCreditPurchases).where(eq(socialCreditPurchases.accountId, accountId))).length, 1);
  assert.equal((await db.select().from(socialLedger).where(eq(socialLedger.accountId, accountId))).length, 1);
  assert.equal((await db.select().from(socialWallets).where(eq(socialWallets.accountId, accountId)))[0]?.balance, 1_000);
  await assert.rejects(
    recordConfirmedCreditPurchase(accountId, "fixture", providerPurchaseId, 5_000),
    /already applied to a different purchase/,
  );
});
