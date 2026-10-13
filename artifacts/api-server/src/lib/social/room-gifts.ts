import { db, socialGiftEvents, socialRelations, accountProfiles } from '@workspace/db';
import { and, desc, eq, or } from 'drizzle-orm';
import { requireAdult } from '../community';
import { roomStore, RoomError } from '../room-store';
import { giftNameColorsForAccounts } from './gift-name-color-data';
import { passportBadgeSummaries } from './passport';
import { visibleMonthlyPurchaseBadgeSummaries } from './monthly-credit-badges';

export function validateGiftRoom(roomId: string, sessionId: string, senderId: string, recipientId: string) {
  if (!roomStore.isCommunity(roomId)) throw new RoomError(404, 'University not found');
  roomStore.requireAccountMember(roomId, sessionId, senderId);
  const room = roomStore.get(roomId);
  if (!room.participants.some(p => roomStore.sessionAccountId(roomId, p.participantId) === recipientId))
    throw new RoomError(409, 'This person is no longer in this university. Choose someone who is here.');
  return roomStore.getHistoryId(roomId);
}

export async function roomGiftEvents(id: string, roomId: string, sessionId: string) {
  await requireAdult(id);
  if (!roomStore.isCommunity(roomId)) throw new RoomError(404, 'University not found');
  roomStore.requireAccountMember(roomId, sessionId, id);
  const blocks = await db.select().from(socialRelations).where(and(eq(socialRelations.kind, 'block'),
    or(eq(socialRelations.ownerId, id), eq(socialRelations.targetId, id))));
  const hidden = new Set(blocks.map(r => r.ownerId === id ? r.targetId : r.ownerId));
  const rows = await db.select().from(socialGiftEvents)
    .where(eq(socialGiftEvents.historyId, roomStore.getHistoryId(roomId)))
    .orderBy(desc(socialGiftEvents.createdAt), desc(socialGiftEvents.id)).limit(60);
  const nameColors = await giftNameColorsForAccounts(rows.flatMap(row =>
    [row.senderId, row.recipientId].filter((accountId): accountId is string => !!accountId)));
  const passports = await passportBadgeSummaries(rows.flatMap(row =>
    [row.senderId, row.recipientId].filter((accountId): accountId is string => !!accountId)));
  const badges = await visibleMonthlyPurchaseBadgeSummaries(rows.flatMap(row =>
    [row.senderId, row.recipientId].filter((accountId): accountId is string => !!accountId)));
  const testIds = process.env.NODE_ENV === "production"
    ? new Set((await db.select({ id: accountProfiles.accountId }).from(accountProfiles)
      .where(eq(accountProfiles.isTestAccount, true))).map(row => row.id))
    : new Set<string>();
  return { events: rows.filter(r => !hidden.has(r.senderId ?? '') && !hidden.has(r.recipientId ?? '')
    && !testIds.has(r.senderId ?? '') && !testIds.has(r.recipientId ?? '')).reverse().map(r => ({
    id: r.id, giftId: r.giftId, senderUsername: r.senderUsername, recipientUsername: r.recipientUsername,
    senderName: r.senderName, recipientName: r.recipientName,
    senderNameColor: r.senderId ? nameColors.get(r.senderId) ?? "#FFFFFF" : "#FFFFFF",
    recipientNameColor: r.recipientId ? nameColors.get(r.recipientId) ?? "#FFFFFF" : "#FFFFFF",
    senderBadgeId: r.senderId ? badges.get(r.senderId)?.tier.id ?? null : null,
    recipientBadgeId: r.recipientId ? badges.get(r.recipientId)?.tier.id ?? null : null,
    senderBadgeName: r.senderId ? badges.get(r.senderId)?.tier.name ?? null : null,
    recipientBadgeName: r.recipientId ? badges.get(r.recipientId)?.tier.name ?? null : null,
    senderBadgeImage: r.senderId ? badges.get(r.senderId)?.tier.badgeImage ?? null : null,
    recipientBadgeImage: r.recipientId ? badges.get(r.recipientId)?.tier.badgeImage ?? null : null,
    senderPassport: r.senderId ? passports.get(r.senderId) : undefined,
    recipientPassport: r.recipientId ? passports.get(r.recipientId) : undefined,
    createdAt: r.createdAt.toISOString(),
  })) };
}
