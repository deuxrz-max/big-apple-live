import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db, accountProfiles, socialLedger, socialCreditPurchases } from "@workspace/db";
import { nameColorProfilesForAccounts } from "./gift-name-color-data";

test("gifting uses only successful outgoing coin value, never recharges, counts or rolled-back sends", async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Development-only rollback fixture");
  const token = randomUUID().replaceAll("-", "");
  const id = `gifting-rollback-${token}`;
  const other = `${id}-other`;
  const rollback = new Error("Roll back every isolated gifting fixture");
  try {
    await db.transaction(async tx => {
      await tx.insert(accountProfiles).values([id, other].map((accountId, index) => ({
        accountId, username: `GiftLevel_${token.slice(0, 12)}_${index}`,
        nameKey: `giftlevel_${token.slice(0, 12)}_${index}`,
        emojiId: "1F600", gender: "Male" as const, color: "#ffffff", hairColor: "#000000",
        isTestAccount: true,
      })));
      const progress = async () => (await nameColorProfilesForAccounts([id], tx)).get(id)!;
      await tx.insert(socialCreditPurchases).values({
        accountId: id, provider: "rollback-fixture", providerPurchaseId: token,
        credits: 1_000_000, confirmedAt: new Date(),
      });
      await tx.insert(socialLedger).values([
        { accountId: id, kind: "credit_purchase", delta: 1_000_000, description: "Recharge" },
        { accountId: id, kind: "reward", delta: 500, description: "Reward" },
        { accountId: id, kind: "gift_received", delta: 900_000, description: "Incoming gifts" },
        { accountId: id, kind: "purchase", delta: -900_000, description: "Store inventory purchase" },
        { accountId: other, kind: "gift_sent", delta: -900_000, description: "Other account" },
      ]);
      assert.equal((await progress()).tierIndex, 0, "recharges and unrelated activity award no gifting level");
      assert.equal((await progress()).color, "#09B0EC", "existing username color is preserved separately");
      await assert.rejects(tx.transaction(async failed => {
        await failed.insert(socialLedger).values({
          accountId: id, kind: "gift_sent", delta: -800_000, description: "Failed transaction",
        });
        throw new Error("send failed");
      }), /send failed/);
      assert.equal((await progress()).lifetimeCoinsPurchased, 0, "failed/rolled-back send contributes nothing");
      const key = randomUUID();
      await tx.insert(socialLedger).values({
        accountId: id, kind: "gift_sent", delta: -19_999, description: "Successful gift", requestKey: key,
      });
      assert.equal((await progress()).tierIndex, 0, "19,999 remains the unearned white default");
      await assert.rejects(tx.transaction(async duplicate => {
        await duplicate.insert(socialLedger).values({
          accountId: id, kind: "gift_sent", delta: -19_999, description: "Duplicate retry", requestKey: key,
        });
      }));
      assert.equal((await progress()).lifetimeCoinsPurchased, 19_999, "retry cannot double-count");
      await tx.insert(socialLedger).values({
        accountId: id, kind: "gift_sent", delta: -1, description: "Threshold gift",
      });
      assert.equal((await progress()).tierName, "Green");
      await tx.insert(socialLedger).values({
        accountId: id, kind: "gift_sent", delta: -80_000, description: "Gift ×10 at 8,000 each",
      });
      assert.equal((await progress()).lifetimeCoinsPurchased, 100_000, "receipt total is counted once, not gift count or multiplied again");
      assert.equal((await progress()).tierName, "Pink");
      throw rollback;
    });
  } catch (error) {
    assert.equal(error, rollback);
  } finally {
    await db.$client.end();
  }
});
