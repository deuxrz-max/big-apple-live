import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { db, coinTesters, coinTestLaunchControl, coinTestResetPlans,
  socialSettings, socialWallets, socialCreditPurchases, socialLedger,
  accountRoomEntranceEffects, socialGiftBag } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { applyTestCoinLaunchReset, TEST_COIN_RESET_PHRASE, testCoinsClosed } from "./coin-test-launch";
import { testerState } from "./coin-testers";
import { realGiftingLevel } from "./gifting-access";
import { giftingProgress } from "@workspace/beam-identity";

test("launch reset is explicit, single-use and preserves real funds (TEMP tables only)", async t => {
  assert.equal(process.env.NODE_ENV, "development");
  t.after(() => db.$client.end());
  await db.transaction(async tx => {
    // These connection-local tables shadow the application tables. Not a single
    // real grant, wallet, purchase, reset plan or launch flag is modified.
    for (const table of ["coin_testers", "coin_test_launch_control", "coin_test_reset_plans",
      "social_settings", "social_wallets", "social_credit_purchases", "social_ledger",
      "account_room_entrance_effects", "social_gift_bag"]) {
      assert.match(table, /^[a-z_]+$/);
      await tx.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`));
    }
    const ownerId = "isolated-launch-owner";
    const freeId = "isolated-free-tester";
    const paidId = "isolated-paid-tester";
    const untouchedId = "isolated-ordinary-member";
    const expiresAt = new Date(Date.now() + 600_000);
    for (const accountId of [freeId, paidId]) {
      await tx.insert(coinTesters).values({
        accountId, enabled: true, designatedBy: ownerId,
        bag: [{ giftId: "test-gift", quantity: 4, expiresAt: expiresAt.toISOString() }],
        effectIds: ["test-effect", "paid-effect"],
      });
      await tx.insert(socialSettings).values({ accountId,
        equippedEntranceEffectId: accountId === freeId ? "test-effect" : "paid-effect" });
    }
    await tx.insert(socialWallets).values([
      { accountId: freeId, balance: 0 },
      { accountId: paidId, balance: 699, received: 17, earned: 25 },
      { accountId: untouchedId, balance: 123, received: 12, earned: 25 },
    ]);
    await tx.insert(socialCreditPurchases).values({
      accountId: paidId, provider: "fixture", providerPurchaseId: randomUUID(), credits: 699, confirmedAt: new Date(),
    });
    await tx.insert(socialLedger).values({
      accountId: paidId, kind: "credit_purchase", delta: 699, description: "Isolated paid purchase",
    });
    // Existing nonfinancial progression must survive retirement too. This is
    // a TEMP fixture, not a change to test-gift XP earning rules.
    await tx.insert(socialLedger).values({
      accountId: freeId, kind: "gift_sent", delta: 0, xpUnits: 5375,
      description: "Isolated pre-existing XP with partial next-level progress",
    });
    const beforeLevel = await realGiftingLevel(freeId, tx);
    const beforeProgress = giftingProgress(5375);
    assert.ok(beforeLevel > 1);
    await tx.insert(accountRoomEntranceEffects).values({ accountId: paidId, effectId: "paid-effect" });
    await tx.insert(socialGiftBag).values({ accountId: paidId, giftId: "paid-gift", quantity: 3 });
    const beforeWallets = await tx.select().from(socialWallets).orderBy(socialWallets.accountId);
    const beforePurchases = await tx.select().from(socialCreditPurchases);
    const beforeLedger = await tx.select().from(socialLedger);
    const beforeBag = await tx.select().from(socialGiftBag);
    const fingerprint = async () => createHash("sha256").update(JSON.stringify(
      await tx.select().from(coinTesters).orderBy(coinTesters.accountId))).digest("hex");
    const newPlan = async (at = expiresAt) => {
      const [row] = await tx.insert(coinTestResetPlans).values({
        ownerId, expiresAt: at, fingerprint: await fingerprint(),
      }).returning();
      return { planId: row!.id, endingTesting: true, confirmation: TEST_COIN_RESET_PHRASE };
    };
    const input = await newPlan();
    await t.test("a stored preview alone does not retire test access or alter money", async () => {
      assert.equal(await testCoinsClosed(tx), null);
      assert.ok(await testerState(freeId, tx));
      assert.deepEqual(await tx.select().from(socialWallets).orderBy(socialWallets.accountId), beforeWallets);
    });
    await t.test("confirmation phrase, launch acknowledgement and plan ownership are required", async () => {
      await assert.rejects(applyTestCoinLaunchReset(tx, ownerId, { ...input, confirmation: "not yet" }), /type END FREE TEST COINS/);
      await assert.rejects(applyTestCoinLaunchReset(tx, ownerId, { ...input, endingTesting: false }), /Confirm/);
      await assert.rejects(applyTestCoinLaunchReset(tx, "different-owner", input), /preview first/);
      assert.equal(await testCoinsClosed(tx), null);
    });
    await t.test("expired previews cannot reset", async () => {
      await assert.rejects(applyTestCoinLaunchReset(tx, ownerId, await newPlan(new Date(0))), /expired/);
      assert.equal(await testCoinsClosed(tx), null);
    });
    await t.test("inventory changes require a fresh preview", async () => {
      await tx.update(coinTesters).set({ bag: [] }).where(eq(coinTesters.accountId, freeId));
      await assert.rejects(applyTestCoinLaunchReset(tx, ownerId, input), /changed/);
      assert.equal(await testCoinsClosed(tx), null);
    });
    const fresh = await newPlan();
    await t.test("explicit reset clears test privileges and artifacts, never paid balances", async () => {
      const result = await applyTestCoinLaunchReset(tx, ownerId, fresh);
      assert.equal(result.alreadyCompleted, false);
      assert.ok(await testCoinsClosed(tx));
      for (const row of await tx.select().from(coinTesters)) {
        assert.equal(row.enabled, false);
        assert.deepEqual(row.bag, []);
        assert.deepEqual(row.effectIds, []);
      }
      assert.equal(await testerState(freeId, tx), null);
      const settings = await tx.select().from(socialSettings);
      assert.equal(settings.find(row => row.accountId === freeId)!.equippedEntranceEffectId, null);
      assert.equal(settings.find(row => row.accountId === paidId)!.equippedEntranceEffectId, "paid-effect");
      assert.deepEqual(await tx.select().from(socialWallets).orderBy(socialWallets.accountId), beforeWallets);
      assert.deepEqual(await tx.select().from(socialCreditPurchases), beforePurchases);
      assert.deepEqual(await tx.select().from(socialLedger), beforeLedger);
      assert.deepEqual(await tx.select().from(socialGiftBag), beforeBag);
    });
    await t.test("earned levels, XP and partial progression survive without cash-out value", async () => {
      const [xpRow] = await tx.select().from(socialLedger).where(eq(socialLedger.accountId, freeId));
      assert.equal(xpRow!.xpUnits, 5375);
      assert.equal(await realGiftingLevel(freeId, tx), beforeLevel);
      assert.deepEqual(giftingProgress(xpRow!.xpUnits), beforeProgress);
      const [wallet] = await tx.select().from(socialWallets).where(eq(socialWallets.accountId, freeId));
      assert.equal(wallet!.balance, 0);
      assert.equal(wallet!.earned, 0);
      assert.equal(wallet!.received, 0);
      assert.deepEqual(await tx.select().from(socialCreditPurchases), beforePurchases);
    });
    await t.test("confirmed retries are idempotent and the closed gate overrides raw grants", async () => {
      assert.equal((await applyTestCoinLaunchReset(tx, ownerId, fresh)).alreadyCompleted, true);
      // Even a stray low-level grant cannot restore unlimited access.
      await tx.update(coinTesters).set({ enabled: true }).where(eq(coinTesters.accountId, freeId));
      assert.equal(await testerState(freeId, tx), null);
      assert.equal((await tx.select().from(coinTestLaunchControl)).length, 1);
    });
  });
});
