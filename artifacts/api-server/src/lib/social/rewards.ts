import { db, socialWallets, socialLedger, socialGiftEvents, coinTesters } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { RoomError, roomStore } from "../room-store";
import { DAILY_REWARD } from "./catalog";
import { assertContact, hasClaimedDaily, lockAccounts, lockPair, requireAccount, targetAccount, wallet } from "./core";
import { SPIRIT_PUP, spiritSplit } from './spirit-pup-policy';
import { validateGiftRoom } from './room-gifts';
import { requireAdult } from '../community';
import { planCreditSpend } from "./credits-policy";
import { testerState, replayTestAction, recordTestAction, consumeTestBag, assertCoinMode } from "./coin-testers";
import { addGiftBagLot, consumeGiftBagItems, ensureGiftBagLots, expirePurchasedGiftLots } from "./gift-bag-inventory";
import { liveStreamIdForAccount, isLiveStreamActiveOrStarting } from "../live-stream-policy";
import { getSendableGiftCatalogItem } from "../gift-studio-catalog";
import { requireSendableGift } from "../gift-availability";
import { giftChargeTotal } from "./gift-quantity";
import { assertGiftingAccess } from "./gifting-access";
import { nameColorProfileForAccount } from "./gift-name-color-data";
import { enterPinkReward } from "../pink-card-rewards";
import { rewardCycleBounds } from "../pink-card-policy";
import { recordPkGiftInTransaction } from "../pk-battles";

const giftSendTails = new Map<string, Promise<void>>();

/** Preserve the accepted order of gift sends within a room or live stream. */
export async function serializeGiftSends<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  const prior = giftSendTails.get(scope) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  giftSendTails.set(scope, gate);
  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (giftSendTails.get(scope) === gate) giftSendTails.delete(scope);
  }
}

/** Unlimited test gifts keep the wallet balance unchanged but retain their nominal value in the ledger. */
export function giftLedgerDebit(debit: number, cost: number, unlimited: boolean): number {
  return unlimited ? cost : debit;
}

export async function claimDaily(id: string) {
  const profile = await requireAccount(id);
  const result = await db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    const [row] = await tx.select().from(socialWallets).where(eq(socialWallets.accountId, id));
    const at = new Date();
    const { cycle: day } = rewardCycleBounds(at);
    if (await hasClaimedDaily(id, row!.lastClaimDay, tx, at)) throw new RoomError(409, "Today's reward is already claimed. Come back after 3 AM Eastern.");
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${DAILY_REWARD}`,
      earned: sql`${socialWallets.earned} + ${DAILY_REWARD}`, lastClaimDay: day }).where(eq(socialWallets.accountId, id));
    await tx.insert(socialLedger).values({ accountId: id, delta: DAILY_REWARD, kind: "reward", description: `Daily reward · ${day}`, createdAt: at });
    await enterPinkReward(tx, id, at);
    return wallet(id, tx, profile.username);
  });
  return result;
}
export async function gift(id: string, recipient: string, giftId: string, key: string,
  context?: { roomId: string; sessionId: string } | { streamId: string }, quantity = 1, useGiftBagOnly = false, expectedTestMode = false) {
  const sender = await requireAccount(id);
  const target = await targetAccount(recipient);
  const item = requireSendableGift(
    await getSendableGiftCatalogItem(giftId),
    () => new RoomError(409, "This gift isn't available right now."),
  );
  const totalCost = giftChargeTotal(item.cost, quantity);
  if (totalCost === null) throw new RoomError(400, "Choose a valid gift quantity and price.");
  const roomGift = item.roomGift;
  const roomContext = context && "roomId" in context ? context : null;
  const streamContext = context && "streamId" in context ? context : null;
  if (roomGift) {
    if (!context) throw new RoomError(400, `Send ${item.name} from a room or livestream gift panel`);
  }
  if (roomGift || roomContext || streamContext) {
    await requireAdult(id);
    await requireAdult(target.accountId);
  }
  if (streamContext) {
    if (target.accountId !== id && (liveStreamIdForAccount(target.accountId) !== streamContext.streamId
      || !(await isLiveStreamActiveOrStarting(target.accountId)))) {
      throw new RoomError(404, "This livestream is no longer available.");
    }
  }
  const result = await db.transaction(async tx => {
    await lockPair(tx, id, target.accountId);
    if (id !== target.accountId) await assertContact(tx, id, target.accountId);
    await lockAccounts(tx, [id, target.accountId]);
    const boundHistory = roomContext ? roomStore.getHistoryId(roomContext.roomId.toUpperCase()) : null;
    const ref = `gift:${giftId}:${target.accountId}${boundHistory ? ':' + boundHistory : streamContext ? ':live:' + streamContext.streamId : ''}`;
    if (await replayTestAction(tx, id, key, ref)) return { wallet: await wallet(id, tx, sender.username), liveGiftEvent: null };
    await assertGiftingAccess(id, item, tx);
    const historyId = roomContext
      ? validateGiftRoom(roomContext.roomId.toUpperCase(), roomContext.sessionId, id, target.accountId)
      : null;
    if (roomContext && historyId !== boundHistory) throw new RoomError(409, 'This room changed. Re-enter before sending.');
    const now = new Date();
    const testing = !!await testerState(id, tx);
    assertCoinMode(testing, expectedTestMode);
    if (testing) await consumeTestBag(tx, id, item.id, quantity, useGiftBagOnly);
    const held = testing ? 0 : await consumeGiftBagItems(tx, id, item.id, quantity, now);
    if (!testing && useGiftBagOnly && held !== quantity) throw new RoomError(409, "That stored gift is no longer available in your bag.");
    const billableCost = totalCost - held * item.cost;
    const current = await wallet(id, tx, sender.username);
    const unlimited = testing;
    const spend = planCreditSpend(current.balance, billableCost, unlimited);
    if (!spend.allowed) throw new RoomError(409, roomGift ? "Not enough coins. Open the coin store to get more." : "Not enough coins. Claim a daily coin reward first.");
    const recipientCredits = testing ? 0 : roomGift ? spiritSplit(totalCost).recipientCredits : totalCost;
    if (!testing) {
    if (spend.debit > 0) {
      await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} - ${spend.debit}`, sent: sql`${socialWallets.sent} + ${totalCost}` }).where(eq(socialWallets.accountId, id));
    } else {
      await tx.update(socialWallets).set({ sent: sql`${socialWallets.sent} + ${totalCost}` }).where(eq(socialWallets.accountId, id));
    }
    await tx.update(socialWallets).set({ balance: sql`${socialWallets.balance} + ${recipientCredits}`, received: sql`${socialWallets.received} + ${recipientCredits}` }).where(eq(socialWallets.accountId, target.accountId));
    await tx.insert(socialLedger).values([
      { accountId: id, delta: -giftLedgerDebit(spend.debit, totalCost, unlimited), kind: "gift_sent", xpUnits: totalCost, description: `${item.name}${quantity > 1 ? ` ×${quantity}` : ""} sent to ${target.username}${unlimited ? " (development unlimited coins)" : ""}`, peer: target.username, requestKey: key, refKey: ref },
      { accountId: target.accountId, delta: recipientCredits, kind: "gift_received", description: `${item.name}${quantity > 1 ? ` ×${quantity}` : ""} from ${sender.username}`, peer: sender.username },
    ]);
    } else {
      await recordTestAction(tx, id, key, ref);
    }
    let liveGiftEvent: {
      streamId: string; senderAccountId: string; senderUsername: string; senderName: string;
      recipientUsername: string; recipientName: string; giftId: string; giftName: string; cost: number; quantity: number;
    } | null = null;
    if (roomContext) {
      await tx.insert(socialGiftEvents).values({
        historyId: historyId!, senderId: id, recipientId: target.accountId,
        senderUsername: sender.username, recipientUsername: target.username,
        senderName: sender.displayName ?? sender.username, recipientName: target.displayName ?? target.username,
        giftId: item.id, testMode: testing, cost: testing ? 0 : totalCost, quantity, recipientCredits, houseCredits: testing ? 0 : totalCost - recipientCredits,
      });
    }
    if (!testing && roomGift && roomContext) {
      await addGiftBagLot(tx, target.accountId, item.id, quantity, "received", now);
    }
    if (streamContext) {
      if (!testing && roomGift) {
        await addGiftBagLot(tx, target.accountId, item.id, quantity, "received", now);
      }
      liveGiftEvent = {
        streamId: streamContext.streamId, senderAccountId: id, senderUsername: sender.username,
        senderName: sender.displayName ?? sender.username, recipientUsername: target.username,
        recipientName: target.displayName ?? target.username, giftId: item.id, giftName: testing ? `${item.name} · Test gift` : item.name, cost: testing ? 0 : totalCost, quantity,
      };
      if (!testing) await recordPkGiftInTransaction(tx, {
        senderAccountId: id, recipientAccountId: target.accountId,
        giftId: item.id, giftName: item.name, coins: totalCost, createdAt: now,
      });
    }
    return { wallet: await wallet(id, tx, sender.username), liveGiftEvent };
  });
  const progress = await nameColorProfileForAccount(id);
  roomStore.updateAccountNameColor(id, progress.color, progress.tierIndex);
  return streamContext ? { ...result.wallet, liveGiftEvent: result.liveGiftEvent } : result.wallet;
}
export async function purchase(id: string, itemId: string, key: string, expectedTestMode = false) {
  const buyer = await requireAccount(id);
  await requireAdult(id);
  const item = await getSendableGiftCatalogItem(itemId);
  if (!item || item.productType !== "gift") {
    throw new RoomError(410, "Badge tiers are earned through confirmed coin purchases; they cannot be bought with wallet coins.");
  }
  const ref = `store-gift:${item.id}`;
  return db.transaction(async tx => {
    await lockAccounts(tx, [id]);
    if (await replayTestAction(tx, id, key, ref)) return wallet(id, tx, buyer.username);
    await assertGiftingAccess(id, item, tx);
    const purchasedAt = new Date();
    const tester = await testerState(id, tx);
    assertCoinMode(!!tester, expectedTestMode);
    if (tester) {
      await tx.update(coinTesters).set({ bag: [...tester.bag.filter(lot => new Date(lot.expiresAt) > purchasedAt),
        { giftId: item.id, quantity: 1, expiresAt: new Date(purchasedAt.getTime() + 7 * 86400000).toISOString() }] })
        .where(eq(coinTesters.accountId, id));
      await recordTestAction(tx, id, key, ref);
      return wallet(id, tx, buyer.username);
    }
    await ensureGiftBagLots(tx, id);
    await expirePurchasedGiftLots(tx, id, purchasedAt);
    const [current] = await tx.select().from(socialWallets).where(eq(socialWallets.accountId, id));
    if (!current) throw new RoomError(409, "Open Rewards to initialize your wallet");
    const unlimited = false;
    const spend = planCreditSpend(current.balance, item.cost, unlimited);
    if (!spend.allowed) throw new RoomError(409, `You need ${item.cost} coins to add ${item.name} to your collection.`);
    if (spend.debit > 0) {
      await tx.update(socialWallets)
        .set({ balance: sql`${socialWallets.balance} - ${spend.debit}` })
        .where(eq(socialWallets.accountId, id));
    }
    await tx.insert(socialLedger).values({
      accountId: id,
      delta: -giftLedgerDebit(spend.debit, item.cost, unlimited),
      kind: "purchase",
      description: `Store collectible · ${item.name}`,
      requestKey: key as `${string}-${string}-${string}-${string}-${string}`,
      refKey: ref,
    });
    await addGiftBagLot(tx, id, item.id, 1, "purchase", purchasedAt,
      new Date(purchasedAt.getTime() + 7 * 24 * 60 * 60 * 1000));
    return wallet(id, tx, buyer.username);
  });
}
export async function ledger(id: string) {
  const rows = await db.select().from(socialLedger).where(eq(socialLedger.accountId, id)).orderBy(desc(socialLedger.createdAt), desc(socialLedger.id)).limit(100);
  return { transactions: rows.map(r => ({ id: r.id, createdAt: r.createdAt, delta: r.delta, kind: r.kind, description: r.description, peer: r.peer })) };
}
