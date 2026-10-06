import { db, socialWallets, socialLedger, socialInventory, socialSettings } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { RoomError } from "../room-store";
import { DAILY_REWARD, GIFTS, PRODUCTS } from "./catalog";
import { assertContact, lockAccounts, lockPair, replay, requireAccount, targetAccount, wallet } from "./core";

export async function claimDaily(id: string) {
  await requireAccount(id);
  return db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    const [row] = await tx.select().from(socialWallets).where(eq(socialWallets.accountId, id));
    const day = new Date().toISOString().slice(0, 10);
    if (row!.lastClaimDay === day) throw new RoomError(409, "Today's reward is already claimed. Come back after 00:00 UTC.");
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${DAILY_REWARD}`,
      earned: sql`${socialWallets.earned} + ${DAILY_REWARD}`, lastClaimDay: day }).where(eq(socialWallets.accountId, id));
    await tx.insert(socialLedger).values({ accountId: id, delta: DAILY_REWARD, kind: "reward", description: `Daily reward · ${day}` });
    return wallet(id, tx);
  });
}
export async function gift(id: string, recipient: string, giftId: string, key: string) {
  const sender = await requireAccount(id);
  const target = await targetAccount(recipient);
  const item = GIFTS.find(g => g.id === giftId);
  if (!item) throw new RoomError(400, "Choose a gift from the catalog");
  return db.transaction(async tx => {
    await lockPair(tx, id, target.accountId);
    await assertContact(tx, id, target.accountId);
    await lockAccounts(tx, [id, target.accountId]);
    const ref = `gift:${giftId}:${target.accountId}`;
    if (await replay(tx, id, key, ref)) return wallet(id, tx);
    const current = await wallet(id, tx);
    if (current.balance < item.cost) throw new RoomError(409, "Not enough credits. Claim a daily reward first.");
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} - ${item.cost}`, sent: sql`${socialWallets.sent} + ${item.cost}` }).where(eq(socialWallets.accountId, id));
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${item.cost}`, received: sql`${socialWallets.received} + ${item.cost}` }).where(eq(socialWallets.accountId, target.accountId));
    await tx.insert(socialLedger).values([
      { accountId: id, delta: -item.cost, kind: "gift_sent", description: `${item.name} sent to ${target.username}`, peer: target.username, requestKey: key, refKey: ref },
      { accountId: target.accountId, delta: item.cost, kind: "gift_received", description: `${item.name} from ${sender.username}`, peer: sender.username },
    ]);
    return wallet(id, tx);
  });
}
export async function purchase(id: string, itemId: string, key: string) {
  await requireAccount(id);
  const item = PRODUCTS.find(p => p.id === itemId);
  if (!item) throw new RoomError(400, "Choose a product from the catalog");
  return db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    if (await replay(tx, id, key, `purchase:${itemId}`)) return wallet(id, tx);
    const owned = await tx.select().from(socialInventory).where(eq(socialInventory.accountId, id));
    if (owned.some(p => p.itemId === itemId)) throw new RoomError(409, "You already own this badge");
    if ((await wallet(id, tx)).balance < item.cost) throw new RoomError(409, "Not enough credits to buy this badge");
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} - ${item.cost}` }).where(eq(socialWallets.accountId, id));
    await tx.insert(socialInventory).values({ accountId: id, itemId });
    await tx.update(socialSettings).set({ badgeId: itemId }).where(eq(socialSettings.accountId, id));
    await tx.insert(socialLedger).values({ accountId: id, delta: -item.cost, kind: "purchase", description: `${item.name} badge`, requestKey: key, refKey: `purchase:${itemId}` });
    return wallet(id, tx);
  });
}
export async function ledger(id: string) {
  const rows = await db.select().from(socialLedger).where(eq(socialLedger.accountId, id)).orderBy(desc(socialLedger.createdAt), desc(socialLedger.id)).limit(100);
  return { transactions: rows.map(r => ({ id: r.id, createdAt: r.createdAt, delta: r.delta, kind: r.kind, description: r.description, peer: r.peer })) };
}
