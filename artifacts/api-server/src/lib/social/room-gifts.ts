import { db, socialGiftEvents, socialRelations, accountProfiles } from '@workspace/db';
import { and, asc, desc, eq, gt, gte, or } from 'drizzle-orm';
import { requireAdult } from '../community';
import { roomStore, RoomError } from '../room-store';
import { nameColorProfilesForAccounts } from './gift-name-color-data';
import { activeGiftNames } from '../gift-studio-catalog';

export function validateGiftRoom(roomId: string, sessionId: string, senderId: string, recipientId: string) {
  if (!roomStore.isCommunity(roomId)) throw new RoomError(404, 'Room not found');
  roomStore.requireAccountMember(roomId, sessionId, senderId);
  const room = roomStore.get(roomId);
  if (!room.participants.some(p => roomStore.sessionAccountId(roomId, p.participantId) === recipientId))
    throw new RoomError(409, 'This person is no longer in this room. Choose someone who is here.');
  return roomStore.getHistoryId(roomId);
}

const PAGE_SIZE = 100;
function encodeGiftCursor(eventOrder: number): string {
  return Buffer.from(String(eventOrder)).toString('base64url');
}

function decodeGiftCursor(value: string): number | null {
  try {
    const order = Number(Buffer.from(value, 'base64url').toString('utf8'));
    return Number.isSafeInteger(order) && order > 0 ? order : null;
  } catch {
    return null;
  }
}

export async function roomGiftEvents(
  id: string,
  roomId: string,
  sessionId: string,
  page: { after?: string; since?: string } = {},
) {
  await requireAdult(id);
  if (!roomStore.isCommunity(roomId)) throw new RoomError(404, 'Room not found');
  roomStore.requireAccountMember(roomId, sessionId, id);
  const historyId = roomStore.getHistoryId(roomId);
  const blocks = await db.select().from(socialRelations).where(and(eq(socialRelations.kind, 'block'),
    or(eq(socialRelations.ownerId, id), eq(socialRelations.targetId, id))));
  const hidden = new Set(blocks.map(r => r.ownerId === id ? r.targetId : r.ownerId));
  let rows: typeof socialGiftEvents.$inferSelect[];
  let hasMore = false;
  if (page.after) {
    const cursor = decodeGiftCursor(page.after);
    if (cursor === null) throw new RoomError(400, 'The room gift queue needs a refresh. Re-enter the room and try again.');
    const ordered = await db.select().from(socialGiftEvents)
      .where(and(eq(socialGiftEvents.historyId, historyId), gt(socialGiftEvents.eventOrder, cursor)))
      .orderBy(asc(socialGiftEvents.eventOrder))
      .limit(PAGE_SIZE + 1);
    hasMore = ordered.length > PAGE_SIZE;
    rows = ordered.slice(0, PAGE_SIZE);
  } else if (page.since) {
    const sinceTime = Date.parse(page.since);
    if (!Number.isFinite(sinceTime)) throw new RoomError(400, 'The room gift queue needs a refresh. Re-enter the room and try again.');
    const ordered = await db.select().from(socialGiftEvents)
      .where(and(eq(socialGiftEvents.historyId, historyId), gte(socialGiftEvents.createdAt, new Date(sinceTime))))
      .orderBy(asc(socialGiftEvents.eventOrder))
      .limit(PAGE_SIZE + 1);
    hasMore = ordered.length > PAGE_SIZE;
    rows = ordered.slice(0, PAGE_SIZE);
  } else {
    rows = (await db.select().from(socialGiftEvents)
      .where(eq(socialGiftEvents.historyId, historyId))
      .orderBy(desc(socialGiftEvents.eventOrder)).limit(60)).reverse();
  }
  const nextCursor = rows.length
    ? encodeGiftCursor(rows[rows.length - 1]!.eventOrder)
    : page.after ?? null;
  const [nameColors, giftNames] = await Promise.all([
    nameColorProfilesForAccounts(rows.flatMap(row =>
      [row.senderId, row.recipientId].filter((accountId): accountId is string => !!accountId))),
    activeGiftNames(rows.map((row) => row.giftId)),
  ]);
  const testIds = process.env.NODE_ENV === "production"
    ? new Set((await db.select({ id: accountProfiles.accountId }).from(accountProfiles)
      .where(eq(accountProfiles.isTestAccount, true))).map(row => row.id))
    : new Set<string>();
  return {
    events: rows.filter(r => !hidden.has(r.senderId ?? '') && !hidden.has(r.recipientId ?? '')
      && !testIds.has(r.senderId ?? '') && !testIds.has(r.recipientId ?? '')).map(r => ({
    id: r.id, giftId: r.giftId, giftName: giftNames.get(r.giftId) ?? r.giftId,
    quantity: r.quantity,
    senderUsername: r.senderUsername, recipientUsername: r.recipientUsername,
    senderName: r.senderName, recipientName: r.recipientName,
    senderNameColor: r.senderId ? nameColors.get(r.senderId)?.color ?? "#FFFFFF" : "#FFFFFF",
    senderNameTierIndex: r.senderId ? nameColors.get(r.senderId)?.tierIndex ?? 0 : 0,
    recipientNameColor: r.recipientId ? nameColors.get(r.recipientId)?.color ?? "#FFFFFF" : "#FFFFFF",
    recipientNameTierIndex: r.recipientId ? nameColors.get(r.recipientId)?.tierIndex ?? 0 : 0,
    senderBadgeId: null,
    recipientBadgeId: null,
    senderBadgeName: null,
    recipientBadgeName: null,
    senderBadgeImage: null,
    recipientBadgeImage: null,
    createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  };
}
