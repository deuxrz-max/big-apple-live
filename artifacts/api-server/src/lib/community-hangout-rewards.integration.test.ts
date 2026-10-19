import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  accountProfiles,
  communityCoinDrops,
  db,
  socialLedger,
  socialWallets,
} from "@workspace/db";
import { creditCoinDropClaimOnce, getHangoutStreakSummary, recordHangoutRoomActivity } from "./community-hangout-rewards";
import { roomStore } from "./room-store";

test("hangout rewards credit one day-7 reward and one coin-drop claim without sign-in", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const accountId = `hangout-fixture-${suffix}`;
  const roomId = `HANGOUT_FIXTURE_${suffix}`.toUpperCase();
  const dropId = randomUUID();
  t.after(async () => {
    await db.delete(communityCoinDrops).where(eq(communityCoinDrops.roomId, roomId));
    await db.delete(accountProfiles).where(eq(accountProfiles.accountId, accountId));
    await db.$client.end();
  });

  await db.insert(accountProfiles).values({
    accountId,
    username: `Hangout_${suffix}`,
    nameKey: `hangout_${suffix}`.toLowerCase(),
    emojiId: "1F600",
    gender: "Male",
    color: "#ffffff",
    hairColor: "#000000",
    isTestAccount: true,
  });
  roomStore.registerCommunity({
    roomId,
    historyId: randomUUID(),
    label: "Hangout test fixture",
    createdAt: new Date(),
    testOnly: false,
  });

  await t.test("exactly seven consecutive active hangout days credit 100 coins once", async () => {
    let daySeven: Date | null = null;
    for (let day = 1; day <= 7; day += 1) {
      const now = new Date(Date.UTC(2026, 0, day, 15));
      const activity = await recordHangoutRoomActivity(accountId, roomId, new Date(now.getTime() - 61_000), now);
      assert.ok(activity);
      assert.equal(activity.days, day);
      assert.equal(activity.rewardedNow, day === 7);
      if (day === 7) daySeven = now;
    }
    const repeated = await recordHangoutRoomActivity(accountId, roomId, new Date(daySeven!.getTime() - 61_000), daySeven!);
    assert.equal(repeated?.rewardedNow, false);
    const [wallet] = await db.select().from(socialWallets).where(eq(socialWallets.accountId, accountId));
    assert.equal(wallet?.balance, 100);
    const rewards = await db.select().from(socialLedger)
      .where(and(eq(socialLedger.accountId, accountId), eq(socialLedger.kind, "reward")));
    assert.equal(rewards.length, 1);

    const missedDaySummary = await getHangoutStreakSummary(accountId, new Date(Date.UTC(2026, 0, 10, 15)));
    assert.equal(missedDaySummary.days, 0);
    const reset = await recordHangoutRoomActivity(
      accountId, roomId, new Date(Date.UTC(2026, 0, 10, 15) - 61_000), new Date(Date.UTC(2026, 0, 10, 15)),
    );
    assert.equal(reset?.days, 1);
    assert.equal(reset?.rewardedNow, false);
  });

  await t.test("the same drop can credit an account only once", async () => {
    await db.insert(communityCoinDrops).values({ id: dropId, roomId, amount: 37, startedAt: new Date() });
    assert.equal(await creditCoinDropClaimOnce(dropId, accountId, 37), true);
    assert.equal(await creditCoinDropClaimOnce(dropId, accountId, 37), false);
    const [wallet] = await db.select().from(socialWallets).where(eq(socialWallets.accountId, accountId));
    assert.equal(wallet?.balance, 137);
    const rewards = await db.select().from(socialLedger)
      .where(and(eq(socialLedger.accountId, accountId), eq(socialLedger.description, `Room coin drop · ${dropId}`)));
    assert.equal(rewards.length, 1);
  });
});
