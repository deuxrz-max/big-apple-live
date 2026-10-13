import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, accountProfiles, accountRoomEntranceEffects } from "@workspace/db";
import { claimRoomEntranceEffect } from "./room-entrance-effects";

test("entrance claims deduplicate a single join retry but allow every later entry", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const accountId = `entrance-effect-fixture-${suffix}`;
  const username = `Effect_${suffix}`;
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

  assert.equal(await claimRoomEntranceEffect(accountId, "monthly-tier-4", "entry-attempt-1", 10_000), "monthly-tier-4");
  assert.equal(await claimRoomEntranceEffect(accountId, "monthly-tier-4", "entry-attempt-1", 10_001), null);
  assert.equal(await claimRoomEntranceEffect(accountId, "monthly-tier-4", "entry-attempt-2", 10_002), "monthly-tier-4");

  await db.insert(accountRoomEntranceEffects).values({ accountId, effectId: "lion-entrance" }).onConflictDoNothing();
  assert.equal(await claimRoomEntranceEffect(accountId, "lion-entrance", "entry-attempt-3", 10_003), "lion-entrance");
  assert.equal(await claimRoomEntranceEffect(accountId, "lion-entrance", "entry-attempt-4", 10_004), "lion-entrance");

  const rows = await db.select().from(accountRoomEntranceEffects).where(eq(accountRoomEntranceEffects.accountId, accountId));
  assert.equal(rows.find(row => row.effectId === "monthly-tier-4")?.lastTriggeredAt?.getTime(), 10_002);
  assert.equal(rows.find(row => row.effectId === "lion-entrance")?.lastTriggeredAt?.getTime(), 10_004);
});
