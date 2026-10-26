import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, accountProfiles, socialWallets, socialLedger, socialGiftBag, pinkRewardDraws, pinkRewardEntries, pinkRewardPreferences } from "@workspace/db";
import { processPinkRewardCycle, enterPinkReward, setPinkRewardPreference, pinkRewardEntry } from "./pink-card-rewards";
import { rewardCycleBounds } from "./pink-card-policy";
import { claimDaily } from "./social/rewards";
import { wallet } from "./social/core";
import { CAULDRON_OVERFLOW_VERSION_ID } from "./system-cauldron-assets";
import type { listGiftCatalogForOwner } from "./gift-studio-catalog";

test("pink rewards: persistent atomic entries, single winner, cooldown, restart/retry and bag awards", async t => {
  const token = randomUUID().slice(0, 8);
  const ids = [0, 1, 2].map(i => `pink-fixture-${token}-${i}`);
  // Far-future fixture cycle: no normal user's entries/draws are touched.
  const at = new Date("2097-07-13T15:00:00Z");
  const { cycle, start } = rewardCycleBounds(at);
  const prefix = `pink-test-${token}`;
  const catalog = [{ id: "rose", name: "Test Rose", cost: 1, productType: "gift", status: "active",
    platinumExclusive: false, roomGift: true, animationAvailable: true, iconUrl: null, iconStatus: "builtin" }] as Awaited<ReturnType<typeof listGiftCatalogForOwner>>;
  const drawId = (i: number) => `${prefix}:${i}`;
  t.after(async () => {
    await db.delete(pinkRewardDraws).where(sql`${pinkRewardDraws.id} LIKE ${prefix + ":%"}`);
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await pool.end();
  });
  await db.insert(accountProfiles).values(ids.map((id, i) => ({
    accountId: id, username: `Pink_${token}_${i}`, nameKey: `pink_${token}_${i}`,
    emojiId: "1F600", gender: "Male" as const, color: "#000000", hairColor: "#000000",
    // These are explicitly scoped, synthetic fixtures removed by t.after.
    isTestAccount: false,
  })));
  await db.insert(socialWallets).values(ids.map(accountId => ({ accountId })));

  await t.test("six concurrent daily claims credit exactly 25 once and atomically enter the pool", async () => {
    const result = await Promise.allSettled(Array.from({ length: 6 }, () => claimDaily(ids[0]!)));
    assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
    const state = await wallet(ids[0]!);
    assert.equal(state.balance, 25);
    assert.equal(state.canClaimDaily, false);
    assert.equal((await pinkRewardEntry(ids[0]!)).entered, true);
    const receipts = await db.select().from(socialLedger).where(eq(socialLedger.accountId, ids[0]!));
    assert.equal(receipts.length, 1);
    assert.ok((result.find(r => r.status === "fulfilled") as PromiseFulfilledResult<unknown>).value);
  });
  await t.test("opt-out blocks entry on claim and does not change the 25-coin amount", async () => {
    await setPinkRewardPreference(ids[1]!, true);
    await claimDaily(ids[1]!);
    assert.deepEqual(await pinkRewardEntry(ids[1]!), { entered: false, optedOut: true });
    assert.equal((await wallet(ids[1]!)).balance, 25);
    await setPinkRewardPreference(ids[1]!, false);
    assert.deepEqual(await pinkRewardEntry(ids[1]!), { entered: false, optedOut: false });
  });
  await t.test("old UTC claim ledger prevents a second claim in the same Eastern cycle", async () => {
    await db.insert(socialLedger).values({ accountId: ids[2]!, delta: 25, kind: "reward",
      description: `Daily reward · ${new Date().toISOString().slice(0, 10)}` });
    await assert.rejects(claimDaily(ids[2]!), /already claimed/);
    assert.equal((await wallet(ids[2]!)).canClaimDaily, false);
  });
  // Seed only fixture draw IDs. All are future except slot 0.
  await db.insert(pinkRewardDraws).values(Array.from({ length: 6 }, (_, i) => ({
    id: drawId(i), cycle, slot: i, scheduledAt: new Date(+at + i * 3_600_000 - 1),
  })));
  await db.transaction(async tx => { await enterPinkReward(tx, ids[0]!, start); });
  await t.test("parallel requests, retries and new transaction after restart give exactly one bag prize", async () => {
    await Promise.all(Array.from({ length: 4 }, () => db.transaction(tx => processPinkRewardCycle(tx, at, catalog))));
    await db.transaction(tx => processPinkRewardCycle(tx, at, catalog));
    const [bag] = await db.select().from(socialGiftBag).where(eq(socialGiftBag.accountId, ids[0]!));
    assert.equal(bag?.quantity, 1);
    const [draw] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(0)));
    assert.equal(draw?.winnerId, ids[0]);
    assert.equal(draw?.outcome, "awarded");
    assert.equal((await wallet(ids[0]!)).balance, 25, "prizes never credit gold");
  });
  await t.test("one eligible user wins once, then remains excluded at subsequent draws for 24 hours", async () => {
    await db.transaction(tx => processPinkRewardCycle(tx, new Date(+at + 3_600_000), catalog));
    const [draw] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(1)));
    assert.equal(draw?.winnerId, null);
    assert.equal(draw?.outcome, "no-eligible-entries");
  });
  await t.test("inactive and hidden system prizes never enter the prize pool", async () => {
    await db.transaction(async tx => { await enterPinkReward(tx, ids[2]!, start); });
    const hidden = { ...catalog[0]!, id: `studio-${CAULDRON_OVERFLOW_VERSION_ID}` };
    await db.transaction(tx => processPinkRewardCycle(tx, new Date(+at + 2 * 3_600_000), [hidden, { ...catalog[0]!, status: "inactive" }]));
    const [draw] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(2)));
    assert.equal(draw?.outcome, "no-prizes");
    assert.equal(draw?.winnerId, null);
  });
  await t.test("entry claimed after scheduled time is not eligible for a late/restarted draw", async () => {
    await db.update(pinkRewardEntries).set({ claimedAt: new Date(+at + 5 * 3_600_000) })
      .where(and(eq(pinkRewardEntries.accountId, ids[2]!), eq(pinkRewardEntries.cycle, cycle)));
    await db.transaction(tx => processPinkRewardCycle(tx, new Date(+at + 3 * 3_600_000), catalog));
    const [draw] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(3)));
    assert.equal(draw?.outcome, "no-eligible-entries");
  });
  await t.test("two entrants still produce only ONE winner; opting out excludes them immediately", async () => {
    await db.update(pinkRewardEntries).set({ claimedAt: start }).where(eq(pinkRewardEntries.accountId, ids[2]!));
    await setPinkRewardPreference(ids[0]!, true);
    await db.transaction(tx => processPinkRewardCycle(tx, new Date(+at + 4 * 3_600_000), catalog));
    const [draw] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(4)));
    assert.equal(draw?.winnerId, ids[2]);
    const bags = await db.select().from(socialGiftBag).where(eq(socialGiftBag.accountId, ids[2]!));
    assert.equal(bags.length, 1);
    assert.equal(bags[0]!.quantity, 1);
  });
  await t.test("failed transaction leaves neither prize nor settled receipt; retry awards once", async () => {
    await db.transaction(async tx => { await enterPinkReward(tx, ids[1]!, start); });
    const later = new Date(+at + 5 * 3_600_000);
    await assert.rejects(db.transaction(async tx => {
      await processPinkRewardCycle(tx, later, catalog);
      throw new Error("simulated process failure before commit");
    }), /simulated process failure/);
    const [unsettled] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(5)));
    assert.equal(unsettled?.settledAt, null);
    assert.equal((await db.select().from(socialGiftBag).where(eq(socialGiftBag.accountId, ids[1]!))).length, 0);
    await db.transaction(tx => processPinkRewardCycle(tx, later, catalog));
    const [bag] = await db.select().from(socialGiftBag).where(eq(socialGiftBag.accountId, ids[1]!));
    assert.equal(bag?.quantity, 1);
  });
  await t.test("win cooldown crosses daily reset and expires at exactly 24 hours", async () => {
    await setPinkRewardPreference(ids[0]!, false);
    const nextAt = new Date(+at + 20 * 3_600_000);
    const next = rewardCycleBounds(nextAt);
    await db.transaction(async tx => { await enterPinkReward(tx, ids[0]!, next.start); });
    await db.insert(pinkRewardDraws).values([
      { id: drawId(6), cycle: next.cycle, slot: 0, scheduledAt: nextAt },
      { id: drawId(7), cycle: next.cycle, slot: 1, scheduledAt: new Date(+at + 24 * 3_600_000) },
    ]);
    await db.transaction(tx => processPinkRewardCycle(tx, nextAt, catalog));
    const [blocked] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(6)));
    assert.equal(blocked?.outcome, "no-eligible-entries");
    await db.transaction(tx => processPinkRewardCycle(tx, new Date(+at + 24 * 3_600_000), catalog));
    const [awarded] = await db.select().from(pinkRewardDraws).where(eq(pinkRewardDraws.id, drawId(7)));
    assert.equal(awarded?.winnerId, ids[0]);
  });
});
