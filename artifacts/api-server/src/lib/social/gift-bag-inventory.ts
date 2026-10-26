import { socialGiftBag, socialGiftBagLots } from "@workspace/db";
import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";

type GiftBagTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type GiftBagSource = "purchase" | "received" | "reward";

/** Adapt legacy/test-seeded aggregate counts without inventing a purchase date or expiry. */
export async function ensureGiftBagLots(tx: GiftBagTx, accountId: string) {
  await tx.execute(sql`
    INSERT INTO social_gift_bag_lots (account_id, gift_id, quantity, source)
    SELECT b.account_id, b.gift_id,
      b.quantity - COALESCE(SUM(l.quantity), 0)::integer, 'legacy'
    FROM social_gift_bag b
    LEFT JOIN social_gift_bag_lots l
      ON l.account_id = b.account_id AND l.gift_id = b.gift_id
    WHERE b.account_id = ${accountId}
    GROUP BY b.account_id, b.gift_id, b.quantity
    HAVING b.quantity > COALESCE(SUM(l.quantity), 0)
  `);
}

export async function addGiftBagLot(
  tx: GiftBagTx, accountId: string, giftId: string, quantity: number,
  source: GiftBagSource, createdAt: Date, expiresAt: Date | null = null,
) {
  await tx.insert(socialGiftBagLots).values({ accountId, giftId, quantity, source, createdAt, expiresAt });
  await tx.insert(socialGiftBag).values({ accountId, giftId, quantity })
    .onConflictDoUpdate({
      target: [socialGiftBag.accountId, socialGiftBag.giftId],
      set: { quantity: sql`${socialGiftBag.quantity} + ${quantity}` },
    });
}

/** Expire only purchased lots; received and reward inventory is never affected. */
export async function expirePurchasedGiftLots(tx: GiftBagTx, accountId: string, now: Date) {
  await ensureGiftBagLots(tx, accountId);
  const expired = await tx.select({ id: socialGiftBagLots.id, giftId: socialGiftBagLots.giftId, quantity: socialGiftBagLots.quantity })
    .from(socialGiftBagLots)
    .where(and(
      eq(socialGiftBagLots.accountId, accountId),
      eq(socialGiftBagLots.source, "purchase"),
      lte(socialGiftBagLots.expiresAt, now),
    ))
    .for("update");
  if (!expired.length) return;
  await tx.delete(socialGiftBagLots).where(inArray(socialGiftBagLots.id, expired.map(lot => lot.id)));
  const byGift = new Map<string, number>();
  for (const lot of expired) byGift.set(lot.giftId, (byGift.get(lot.giftId) ?? 0) + lot.quantity);
  for (const [giftId, quantity] of byGift) {
    await tx.delete(socialGiftBag).where(and(
      eq(socialGiftBag.accountId, accountId),
      eq(socialGiftBag.giftId, giftId),
      lte(socialGiftBag.quantity, quantity),
    ));
    await tx.update(socialGiftBag).set({ quantity: sql`${socialGiftBag.quantity} - ${quantity}` })
      .where(and(
        eq(socialGiftBag.accountId, accountId),
        eq(socialGiftBag.giftId, giftId),
        gt(socialGiftBag.quantity, quantity),
      ));
  }
}

/** Consume held gifts earliest-expiring-first and report how many were drawn from the bag. */
export async function consumeGiftBagItems(tx: GiftBagTx, accountId: string, giftId: string, requested: number, now: Date) {
  await ensureGiftBagLots(tx, accountId);
  await expirePurchasedGiftLots(tx, accountId, now);
  const lots = await tx.select().from(socialGiftBagLots)
    .where(and(
      eq(socialGiftBagLots.accountId, accountId),
      eq(socialGiftBagLots.giftId, giftId),
      or(sql`${socialGiftBagLots.expiresAt} IS NULL`, gt(socialGiftBagLots.expiresAt, now)),
    ))
    .orderBy(sql`${socialGiftBagLots.expiresAt} ASC NULLS LAST`, asc(socialGiftBagLots.createdAt), asc(socialGiftBagLots.id))
    .for("update");
  let remaining = requested;
  for (const lot of lots) {
    if (!remaining) break;
    const used = Math.min(lot.quantity, remaining);
    if (used === lot.quantity) {
      await tx.delete(socialGiftBagLots).where(eq(socialGiftBagLots.id, lot.id));
    } else {
      await tx.update(socialGiftBagLots).set({ quantity: lot.quantity - used })
        .where(eq(socialGiftBagLots.id, lot.id));
    }
    remaining -= used;
  }
  const consumed = requested - remaining;
  if (consumed > 0) {
    await tx.delete(socialGiftBag).where(and(
      eq(socialGiftBag.accountId, accountId),
      eq(socialGiftBag.giftId, giftId),
      lte(socialGiftBag.quantity, consumed),
    ));
    await tx.update(socialGiftBag)
      .set({ quantity: sql`${socialGiftBag.quantity} - ${consumed}` })
      .where(and(
        eq(socialGiftBag.accountId, accountId),
        eq(socialGiftBag.giftId, giftId),
        gt(socialGiftBag.quantity, consumed),
      ));
  }
  return consumed;
}
