import { db, socialGiftEvents, socialRelations } from '@workspace/db';
import { and, desc, eq, or } from 'drizzle-orm';
import { requireAdult } from '../community';
import { roomStore, RoomError } from '../room-store';

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
  return { events: rows.filter(r => !hidden.has(r.senderId ?? '') && !hidden.has(r.recipientId ?? '')).reverse().map(r => ({
    id: r.id, giftId: r.giftId, senderUsername: r.senderUsername, recipientUsername: r.recipientUsername,
    senderName: r.senderName, recipientName: r.recipientName, createdAt: r.createdAt.toISOString(),
  })) };
}
