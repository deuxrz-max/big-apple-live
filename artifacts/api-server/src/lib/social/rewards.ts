import { db, socialWallets, socialLedger, socialInventory, socialSettings, socialGiftEvents, socialGiftBag } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { RoomError, roomStore } from "../room-store";
import { DAILY_REWARD, GIFTS, PRODUCTS } from "./catalog";
import { assertContact, lockAccounts, lockPair, replay, requireAccount, targetAccount, wallet } from "./core";
import { grantTimedBadge } from './marathon';
import { TIMED_BADGES, NIGHT_OWL } from './marathon-policy';
import { SPIRIT_PUP, spiritSplit } from './spirit-pup-policy';
import { isRoomGift } from './room-gift-policy';
import { validateGiftRoom } from './room-gifts';
import { requireAdult } from '../community';
import { hasDevelopmentUnlimitedCredits, planCreditSpend } from "./credits-policy";
import { giftNameColorForSentCredits } from "./gift-name-color";

export async function claimDaily(id: string) {
  const profile = await requireAccount(id);
  const result = await db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    const [row] = await tx.select().from(socialWallets).where(eq(socialWallets.accountId, id));
    const day = new Date().toISOString().slice(0, 10);
    if (row!.lastClaimDay === day) throw new RoomError(409, "Today's reward is already claimed. Come back after 00:00 UTC.");
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${DAILY_REWARD}`,
      earned: sql`${socialWallets.earned} + ${DAILY_REWARD}`, lastClaimDay: day }).where(eq(socialWallets.accountId, id));
    await tx.insert(socialLedger).values({ accountId: id, delta: DAILY_REWARD, kind: "reward", description: `Daily reward · ${day}` });
    return wallet(id, tx, profile.username);
  });
}
export async function gift(id: string, recipient: string, giftId: string, key: string, context?: { roomId: string; sessionId: string }) {
  const sender = await requireAccount(id);
  const target = await targetAccount(recipient);
  const item = GIFTS.find(g => g.id === giftId);
  if (!item) throw new RoomError(400, "Choose a gift from the catalog");
  const roomGift = isRoomGift(item.id);
  if (roomGift) {
    if (!context) throw new RoomError(400, `Send ${item.name} from a university gift tab`);
    await requireAdult(id);
    await requireAdult(target.accountId);
  }
  const result = await db.transaction(async tx => {
    await lockPair(tx, id, target.accountId);
    await assertContact(tx, id, target.accountId);
    await lockAccounts(tx, [id, target.accountId]);
    const boundHistory = roomGift ? roomStore.getHistoryId(context!.roomId.toUpperCase()) : null;
    const ref = `gift:${giftId}:${target.accountId}${roomGift ? ':' + boundHistory : ''}`;
    if (await replay(tx, id, key, ref)) return wallet(id, tx, sender.username);
    const historyId = roomGift ? validateGiftRoom(context!.roomId.toUpperCase(), context!.sessionId, id, target.accountId) : null;
    if (roomGift && historyId !== boundHistory) throw new RoomError(409, 'This university changed. Re-enter before sending.');
    const current = await wallet(id, tx, sender.username);
    const unlimited = hasDevelopmentUnlimitedCredits(sender.username);
    const spend = planCreditSpend(current.balance, item.cost, unlimited);
    if (!spend.allowed) throw new RoomError(409, roomGift ? "Not enough credits. Open the credit store to get more." : "Not enough credits. Claim a daily reward first.");
    const recipientCredits = roomGift ? spiritSplit(item.cost).recipientCredits : item.cost;
    if (spend.debit > 0) {
      await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} - ${spend.debit}`, sent: sql`${socialWallets.sent} + ${item.cost}` }).where(eq(socialWallets.accountId, id));
    } else {
      await tx.update(socialWallets).set({ sent: sql`${socialWallets.sent} + ${item.cost}` }).where(eq(socialWallets.accountId, id));
    }
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${recipientCredits}`, received: sql`${socialWallets.received} + ${recipientCredits}` }).where(eq(socialWallets.accountId, target.accountId));
    await tx.insert(socialLedger).values([
      { accountId: id, delta: -spend.debit, kind: "gift_sent", description: `${item.name} sent to ${target.username}${unlimited ? " (development unlimited credits)" : ""}`, peer: target.username, requestKey: key, refKey: ref },
      { accountId: target.accountId, delta: recipientCredits, kind: "gift_received", description: `${item.name} from ${sender.username}`, peer: sender.username },
    ]);
    if (roomGift) {
      await tx.insert(socialGiftEvents).values({
        historyId: historyId!, senderId: id, recipientId: target.accountId,
        senderUsername: sender.username, recipientUsername: target.username,
        senderName: sender.displayName ?? sender.username, recipientName: target.displayName ?? target.username,
        giftId: item.id, cost: item.cost, recipientCredits, houseCredits: item.cost - recipientCredits,
      });
      await tx.insert(socialGiftBag).values({ accountId: target.accountId, giftId: item.id, quantity: 1 })
        .onConflictDoUpdate({ target: [socialGiftBag.accountId, socialGiftBag.giftId], set: { quantity: sql`${socialGiftBag.quantity} + 1` } });
    }
    return wallet(id, tx, sender.username);
  });
  const [updatedWallet] = await db.select({ sent: socialWallets.sent }).from(socialWallets)
    .where(eq(socialWallets.accountId, id));
  roomStore.updateAccountNameColor(id, giftNameColorForSentCredits(updatedWallet?.sent ?? 0));
  return result;
}
export async function purchase(id: string, itemId: string, key: string) {
  const profile = await requireAccount(id);
  const item = PRODUCTS.find(p => p.id === itemId);
  if (!item) throw new RoomError(400, "Choose a product from the catalog");
  return db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    if (await replay(tx, id, key, `purchase:${itemId}`)) return wallet(id, tx, profile.username);
    const owned = await tx.select().from(socialInventory).where(eq(socialInventory.accountId, id));
    const timed = TIMED_BADGES.find(p => p.id === itemId);
    const existing = owned.find(p => p.itemId === itemId);
    if (itemId === NIGHT_OWL.id && existing && !existing.expiresAt)
      throw new RoomError(409, "You already own Night Owl permanently. No renewal is needed.");
    if (!timed && existing) throw new RoomError(409, "You already own this badge");
    const unlimited = hasDevelopmentUnlimitedCredits(profile.username);
    const spend = planCreditSpend((await wallet(id, tx, profile.username)).balance, item.cost, unlimited);
    if (!spend.allowed) throw new RoomError(409, "Not enough credits to buy this badge");
    if (spend.debit > 0)
      await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} - ${spend.debit}` }).where(eq(socialWallets.accountId, id));
    if (timed) await grantTimedBadge(tx, id, timed, timed.boughtDays, new Date());
    else await tx.insert(socialInventory).values({ accountId: id, itemId });
    await tx.update(socialSettings).set({ badgeId: itemId }).where(eq(socialSettings.accountId, id));
    await tx.insert(socialLedger).values({ accountId: id, delta: -spend.debit, kind: "purchase", description: `${item.name} badge${unlimited ? " (development unlimited credits)" : ""}`, requestKey: key, refKey: `purchase:${itemId}` });
    return wallet(id, tx, profile.username);
  });
}
export async function ledger(id: string) {
  const rows = await db.select().from(socialLedger).where(eq(socialLedger.accountId, id)).orderBy(desc(socialLedger.createdAt), desc(socialLedger.id)).limit(100);
  return { transactions: rows.map(r => ({ id: r.id, createdAt: r.createdAt, delta: r.delta, kind: r.kind, description: r.description, peer: r.peer })) };
}
