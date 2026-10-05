import { db, accountProfiles, roomMessages, type RoomMessageRow } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { GetRoomMessagesResponse, type ChatInput, type ChatAccepted } from "@workspace/api-zod";
import { messageMood } from "@workspace/beam-identity";
import { publicProfile } from "./account-profiles";
import { roomStore, RoomError, type RoomStore } from "./room-store";

function publicMessage(row: RoomMessageRow) {
  return GetRoomMessagesResponse.element.parse(row);
}
export async function getMessages(roomId: string, store: RoomStore = roomStore) {
  const rows = await db.select().from(roomMessages).where(eq(roomMessages.historyId, store.getHistoryId(roomId)))
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
    const mood = messageMood(row.gender === "Male" ? "spiked" : "ponytails", text);
    let profile = publicProfile(row);
    if (mood) {
      const [updated] = await tx.update(accountProfiles).set({
        currentMood: mood.currentMood, portraitId: mood.portraitId, updatedAt: new Date(),
      }).where(eq(accountProfiles.accountId, accountId)).returning();
      profile = publicProfile(updated!);
    }
    const [message] = await tx.insert(roomMessages).values({
      roomId: roomId.toUpperCase(), historyId, authorId: sender.participantId,
      username: profile.username, identity: profile.identity, kind: input.kind, text,
    }).returning();
    // A leave/expiry while the database was busy rolls back message AND mood.
    store.requireAccountMember(roomId, sessionId, accountId);
    return { message: publicMessage(message!), profile };
  });
  // No events or in-memory avatar changes occur before the transaction commits.
  store.updateAccountIdentity(accountId, accepted.profile.username, accepted.profile.identity);
  store.publishChat(roomId, historyId, accepted);
  return accepted;
}