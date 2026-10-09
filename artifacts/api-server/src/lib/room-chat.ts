import { db, accountProfiles, roomMessages, socialRelations, socialSettings, chatMemberships, moderatorBotFlags, type RoomMessageRow } from "@workspace/db";
import { eq, desc, sql, and, or, gte, notInArray, isNull, lt } from "drizzle-orm";
import { GetRoomMessagesResponse, type ChatInput, type ChatAccepted } from "@workspace/api-zod";
import { publicProfile } from "./account-profiles";
import { roomStore, RoomError, type RoomStore } from "./room-store";
import { ignoredAccounts } from "./university-chat";
import { botSettings, botRotation, botMessageValues } from "./moderator-bots";
import { BOT_ACCOUNTS, BOT_WARNING_COOLDOWN_MS, publicViolation } from "./bot-policy";

function publicMessage(row: RoomMessageRow) {
  return GetRoomMessagesResponse.element.parse(row);
}
export async function getMessages(roomId: string, store: RoomStore = roomStore, viewerId?: string, beforeId?: string) {
  const conditions = [eq(roomMessages.historyId, store.getHistoryId(roomId)), eq(roomMessages.hidden, "false")];
  if (beforeId) {
    const [cursor] = await db.select().from(roomMessages).where(and(
      eq(roomMessages.id, beforeId), eq(roomMessages.historyId, store.getHistoryId(roomId))));
    if (!cursor) throw new RoomError(404, "History cursor not found in this university");
    conditions.push(or(lt(roomMessages.createdAt, cursor.createdAt),
      and(eq(roomMessages.createdAt, cursor.createdAt), lt(roomMessages.id, cursor.id)))!);
  }
  if (viewerId) {
    const ignored = await ignoredAccounts(viewerId);
    if (ignored.length) conditions.push(or(isNull(roomMessages.authorAccountId), notInArray(roomMessages.authorAccountId, ignored))!);
    const relations = await db.select().from(socialRelations).where(and(eq(socialRelations.kind, "block"),
      or(eq(socialRelations.ownerId, viewerId), eq(socialRelations.targetId, viewerId))));
    const blocked = relations.map(r => r.ownerId === viewerId ? r.targetId : r.ownerId);
    if (blocked.length) conditions.push(or(isNull(roomMessages.authorAccountId), notInArray(roomMessages.authorAccountId, blocked))!);
  }
  const rows = await db.select({ message: roomMessages, photoUrl: accountProfiles.photoUrl }).from(roomMessages)
    .leftJoin(accountProfiles, eq(accountProfiles.accountId, roomMessages.authorAccountId)).where(and(...conditions))
    .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id)).limit(60);
  return rows.reverse().map(row => ({ ...publicMessage(row.message), photoUrl: null }));
}
export async function acceptMessage(
  roomId: string, sessionId: string, accountId: string, input: ChatInput,
  store: RoomStore = roomStore,
): Promise<ChatAccepted> {
  const text = input.text.trim();
  if (!text || text.length > 280) throw new RoomError(400, "Write 1–280 characters");
  const sender = store.requireAccountMember(roomId, sessionId, accountId);
  const historyId = store.getHistoryId(roomId);
  const filter = store.isCommunity(roomId) ? await botSettings() : null;
  let rateLimited = false;
  const accepted = await db.transaction(async (tx) => {
    // Same lock as profile editing; serialize public sends and their spam checks.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`);
    store.requireAccountMember(roomId, sessionId, accountId);
    const [row] = await tx.select().from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
    if (!row) throw new RoomError(409, "Complete your account profile first");
    let violation: string | null = null;
    if (filter) {
      const [membership] = await tx.select().from(chatMemberships).where(and(
        eq(chatMemberships.historyId, historyId), eq(chatMemberships.accountId, accountId)));
      if (!membership || membership.muted) throw new RoomError(403, "You cannot send messages in this university");
      const recent = await tx.select({ text: roomMessages.text, createdAt: roomMessages.createdAt }).from(roomMessages)
        .where(and(eq(roomMessages.authorAccountId, accountId),
          gte(roomMessages.createdAt, new Date(Date.now() - 30_000)))).limit(1000);
      rateLimited = recent.filter(m => Date.now() - m.createdAt.getTime() < 10_000).length >= 5;
      violation = publicViolation(text, filter.bannedWords, recent, Date.now());
    }
    // Emoji text never mutates a saved photo or obsolete avatar fields.
    let profile = { ...publicProfile(row), photoUrl: null, photoUrls: [] };
    const [settings] = await tx.select({ bio: socialSettings.bio }).from(socialSettings)
      .where(eq(socialSettings.accountId, accountId));
    profile = { ...profile, bio: settings?.bio ?? "" };
    const [original] = await tx.insert(roomMessages).values({
      roomId: roomId.toUpperCase(), historyId, authorId: sender.participantId, authorAccountId: accountId,
      username: profile.username, identity: profile.identity, kind: input.kind, text, hidden: violation ? "true" : "false",
    }).returning();
    let message = original!;
    if (violation) {
      // Keep the prohibited text private to the moderation queue. Reuse one warning
      // per sender/university/15s so flooding cannot turn bots into public spam.
      const [recentFlag] = await tx.select().from(moderatorBotFlags).where(and(
        eq(moderatorBotFlags.accountId, accountId), eq(moderatorBotFlags.roomId, roomId.toUpperCase()),
        gte(moderatorBotFlags.createdAt, new Date(Date.now() - BOT_WARNING_COOLDOWN_MS)),
      )).orderBy(desc(moderatorBotFlags.createdAt)).limit(1);
      const [existingWarning] = recentFlag?.warningMessageId
        ? await tx.select().from(roomMessages).where(and(eq(roomMessages.id, recentFlag.warningMessageId),
          eq(roomMessages.historyId, historyId), isNull(roomMessages.authorAccountId))).limit(1) : [];
      if (existingWarning) message = existingWarning;
      else {
        const bot = botRotation.people(roomId.toUpperCase())[0] ?? BOT_ACCOUNTS[0];
        const [warning] = await tx.insert(roomMessages).values(botMessageValues(bot, roomId.toUpperCase(), historyId,
          `@${profile.username}, your public message was hidden. Keep it respectful and avoid spam.`)).returning();
        message = warning!;
      }
      await tx.insert(moderatorBotFlags).values({ messageId: original!.id, warningMessageId: message.id,
        roomId: roomId.toUpperCase(), accountId, username: profile.username,
        displayName: profile.displayName ?? profile.username, reason: violation });
    }
    // A leave/expiry while the database was busy rolls back message, flag and warning.
    store.requireAccountMember(roomId, sessionId, accountId);
    return { message: { ...publicMessage(message), photoUrl: null }, profile };
  });
  // No events or in-memory avatar changes occur before the transaction commits.
  store.updateAccountIdentity(accountId, accepted.profile.displayName ?? accepted.profile.username, accepted.profile.identity, null);
  store.publishChat(roomId, historyId, accepted, accepted.message.botId ? undefined : accountId);
  // Preserve the existing public send limit/error, after committing the hidden
  // violation and publishing its warning. Throwing inside the transaction would
  // silently roll both back and leave flooding absent from the review queue.
  if (rateLimited) throw new RoomError(429, "Slow down: up to five messages every ten seconds");
  return accepted;
}