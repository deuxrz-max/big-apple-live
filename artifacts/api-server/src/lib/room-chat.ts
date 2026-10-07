import { db, accountProfiles, roomMessages, socialRelations, chatMemberships, type RoomMessageRow } from "@workspace/db";
import { eq, desc, sql, and, or, gte, notInArray, isNull, lt } from "drizzle-orm";
import { GetRoomMessagesResponse, type ChatInput, type ChatAccepted } from "@workspace/api-zod";
import { messageMood } from "@workspace/beam-identity";
import { publicProfile } from "./account-profiles";
import { roomStore, RoomError, type RoomStore } from "./room-store";

function publicMessage(row: RoomMessageRow) {
  return GetRoomMessagesResponse.element.parse(row);
}
export async function getMessages(roomId: string, store: RoomStore = roomStore, viewerId?: string, beforeId?: string) {
  const conditions = [eq(roomMessages.historyId, store.getHistoryId(roomId)), eq(roomMessages.hidden, "false")];
  if (beforeId) {
    const [cursor] = await db.select().from(roomMessages).where(and(
      eq(roomMessages.id, beforeId), eq(roomMessages.historyId, store.getHistoryId(roomId))));
    if (!cursor) throw new RoomError(404, "History cursor not found in this room");
    conditions.push(or(lt(roomMessages.createdAt, cursor.createdAt),
      and(eq(roomMessages.createdAt, cursor.createdAt), lt(roomMessages.id, cursor.id)))!);
  }
  if (viewerId) {
    const relations = await db.select().from(socialRelations).where(and(eq(socialRelations.kind, "block"),
      or(eq(socialRelations.ownerId, viewerId), eq(socialRelations.targetId, viewerId))));
    const blocked = relations.map(r => r.ownerId === viewerId ? r.targetId : r.ownerId);
    if (blocked.length) conditions.push(or(isNull(roomMessages.authorAccountId), notInArray(roomMessages.authorAccountId, blocked))!);
  }
  const rows = await db.select().from(roomMessages).where(and(...conditions))
    .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id)).limit(60);
  return rows.reverse().map(publicMessage);
}
export async function acceptMessage(
  roomId: string, sessionId: string, accountId: string, input: ChatInput,
  store: RoomStore = roomStore,
): Promise<ChatAccepted> {
  const text = input.text.trim();
  if (!text || text.length > 280) throw new RoomError(400, "Write 1–280 characters");
  const sender = store.requireAccountMember(roomId, sessionId, accountId);
  const historyId = store.getHistoryId(roomId);
  const accepted = await db.transaction(async (tx) => {
    // Same lock as profile editing; concurrent sends cannot overwrite newer moods.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`);
    store.requireAccountMember(roomId, sessionId, accountId);
    const [row] = await tx.select().from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
    if (!row) throw new RoomError(409, "Complete your account profile first");
    if (store.isCommunity(roomId)) {
      const [membership] = await tx.select().from(chatMemberships).where(and(
        eq(chatMemberships.historyId, historyId), eq(chatMemberships.accountId, accountId)));
      if (!membership || membership.muted) throw new RoomError(403, "You cannot send messages in this room");
      const [recent] = await tx.select({ count: sql<number>`count(*)::int` }).from(roomMessages)
        .where(and(eq(roomMessages.authorAccountId, accountId),
          gte(roomMessages.createdAt, new Date(Date.now() - 10_000))));
      if ((recent?.count ?? 0) >= 5) throw new RoomError(429, "Slow down: up to five messages every ten seconds");
    }
    const mood = messageMood(row.gender === "Male" ? "spiked" : "ponytails", text);
    let profile = publicProfile(row);
    if (mood) {
      const [updated] = await tx.update(accountProfiles).set({
        currentMood: mood.currentMood, portraitId: mood.portraitId, updatedAt: new Date(),
      }).where(eq(accountProfiles.accountId, accountId)).returning();
      profile = publicProfile(updated!);
    }
    const [message] = await tx.insert(roomMessages).values({
      roomId: roomId.toUpperCase(), historyId, authorId: sender.participantId, authorAccountId: accountId,
      username: profile.username, identity: profile.identity, kind: input.kind, text,
    }).returning();
    // A leave/expiry while the database was busy rolls back message AND mood.
    store.requireAccountMember(roomId, sessionId, accountId);
    return { message: publicMessage(message!), profile };
  });
  // No events or in-memory avatar changes occur before the transaction commits.
  store.updateAccountIdentity(accountId, accepted.profile.username, accepted.profile.identity);
  store.publishChat(roomId, historyId, accepted, accountId);
  return accepted;
}