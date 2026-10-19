import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { accountProfiles, db, socialLedger } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { ledger } from "./rewards";

test("transaction history only returns the requested account's newest rows", async (t) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const ids = [`ledger-fixture-${suffix}-a`, `ledger-fixture-${suffix}-b`];
  const names = [`Ledger_${suffix}_a`, `Ledger_${suffix}_b`];

  t.after(async () => {
    await db.delete(socialLedger).where(inArray(socialLedger.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });

  await db.insert(accountProfiles).values(ids.map((accountId, index) => ({
    accountId,
    username: names[index]!,
    nameKey: names[index]!.toLowerCase(),
    emojiId: "1F600",
    gender: "Male" as const,
    color: "#ffffff",
    hairColor: "#000000",
  })));
  await db.insert(socialLedger).values([
    {
      accountId: ids[0]!,
      delta: 1_000,
      kind: "credit_purchase",
      description: "Fixture coin purchase",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
    },
    {
      accountId: ids[0]!,
      delta: -25,
      kind: "gift_sent",
      description: "Fixture gift sent",
      createdAt: new Date("2026-01-02T10:00:00.000Z"),
    },
    {
      accountId: ids[1]!,
      delta: 900,
      kind: "credit_purchase",
      description: "Other account purchase",
      createdAt: new Date("2026-01-03T10:00:00.000Z"),
    },
  ]);

  const ownHistory = await ledger(ids[0]!);
  const otherHistory = await ledger(ids[1]!);
  assert.deepEqual(ownHistory.transactions.map((transaction) => transaction.description), [
    "Fixture gift sent",
    "Fixture coin purchase",
  ], "the history is newest first");
  assert.ok(ownHistory.transactions.every((transaction) => !transaction.description.includes("Other account")));
  assert.deepEqual(otherHistory.transactions.map((transaction) => transaction.description), ["Other account purchase"]);
}
);
