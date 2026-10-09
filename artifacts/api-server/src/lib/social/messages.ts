import { db, accountProfiles, socialMessages } from "@workspace/db";
import { and, eq, or, desc, sql, inArray, isNull } from "drizzle-orm";
import { RoomError } from "../room-store";
import { assertContact, lockPair, pairBlocked, person, requireAccount, targetAccount } from "./core";

const pair = (a: string, b: string) => or(and(eq(socialMessages.senderId, a), eq(socialMessages.recipientId, b)), and(eq(socialMessages.senderId, b), eq(socialMessages.recipientId, a)));
const visible = (id: string) => or(and(eq(socialMessages.senderId, id), eq(socialMessages.senderHidden, false)), and(eq(socialMessages.recipientId, id), eq(socialMessages.recipientHidden, false)));
export async function sendMessage(id: string, username: string, text: string, key: string, whisperHistoryId?: string, checkSession?: () => void) {
  const sender = await requireAccount(id);
  const target = await targetAccount(username);
  const body = text.trim();
  if (!body || body.length > 1000) throw new RoomError(400, "Write a message between 1 and 1000 characters");
  const row = await db.transaction(async tx => {
    await lockPair(tx, id, target.accountId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"social-message:" + id}, 0))`);
    await assertContact(tx, id, target.accountId);
    checkSession?.();
    const [existing] = await tx.select().from(socialMessages).where(eq(socialMessages.id, key));
    if (existing) {
      if (existing.senderId !== id || existing.recipientId !== target.accountId || existing.body !== body
        || existing.whisperHistoryId !== (whisperHistoryId ?? null)) throw new RoomError(409, "This retry key belongs to another message");
      return existing;
    }
    const [rate] = await tx.select({ count: sql<number>`count(*)::int` }).from(socialMessages)
      .where(and(eq(socialMessages.senderId, id), sql`${socialMessages.createdAt} > now() - interval '1 minute'`));
    if ((rate?.count ?? 0) >= 30) throw new RoomError(429, "Please slow down; you can send 30 messages per minute");
    const [saved] = await tx.insert(socialMessages).values({ id: key, senderId: id, recipientId: target.accountId, body, whisperHistoryId }).returning();
    checkSession?.();
    return saved!;
  });
  return { id: row.id, sender: sender.username, recipient: target.username, body: row.body, createdAt: row.createdAt, readAt: row.readAt };
}
export async function thread(id: string, username: string, cursor?: string) {
  const me = await requireAccount(id);
  const target = await targetAccount(username);
  if (id === target.accountId) throw new RoomError(400, "Choose another person");
  const [existing] = await db.select({ id: socialMessages.id }).from(socialMessages).where(and(pair(id, target.accountId), visible(id))).limit(1);
  if (!existing) await assertContact(db, id, target.accountId);
  if (cursor) {
    const [allowed] = await db.select({ id: socialMessages.id }).from(socialMessages).where(and(eq(socialMessages.id, cursor), pair(id, target.accountId), visible(id)));
    if (!allowed) throw new RoomError(400, "Invalid history cursor");
  }
  const rows = await db.select().from(socialMessages).where(and(pair(id, target.accountId), visible(id),
    cursor ? sql`(${socialMessages.createdAt}, ${socialMessages.id}) < (SELECT created_at, id FROM social_messages WHERE id = ${cursor})` : undefined,
  )).orderBy(desc(socialMessages.createdAt), desc(socialMessages.id)).limit(101);
  const page = rows.slice(0, 100);
  const readIds = page.filter(m => m.recipientId === id && !m.readAt).map(m => m.id);
  const readAt = new Date();
  if (readIds.length) await db.update(socialMessages).set({ readAt }).where(and(inArray(socialMessages.id, readIds), eq(socialMessages.recipientId, id), isNull(socialMessages.readAt)));
  return { person: await person(id, target), blocked: await pairBlocked(id, target.accountId),
    nextCursor: rows.length > 100 ? page[page.length - 1]!.id : null,
    messages: page.reverse().map(m => ({ id: m.id, sender: m.senderId === id ? me.username : target.username,
      recipient: m.recipientId === id ? me.username : target.username, body: m.body, createdAt: m.createdAt,
      readAt: m.readAt ?? (readIds.includes(m.id) ? readAt : null) })),
  };
}
export async function inbox(id: string) {
  const rows = await db.select().from(socialMessages).where(visible(id)).orderBy(desc(socialMessages.createdAt), desc(socialMessages.id)).limit(5000);
  const grouped = new Map<string, { message: typeof rows[number]; unread: number; lastUnreadAt: Date | null }>();
  for (const row of rows) {
    const other = row.senderId === id ? row.recipientId : row.senderId;
    const entry = grouped.get(other);
    const unread = row.recipientId === id && !row.readAt;
    if (!entry) grouped.set(other, { message: row, unread: unread ? 1 : 0, lastUnreadAt: unread ? row.createdAt : null });
    else if (unread) {
      entry.unread++;
      entry.lastUnreadAt ??= row.createdAt;
    }
  }
  const conversations = [];
  for (const [other, entry] of [...grouped].slice(0, 100)) {
    const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, other));
    if (!profile) continue;
    const p = await person(id, profile);
    conversations.push({ username: p.username, displayName: p.displayName, photoUrl: p.photoUrl,
      lastMessageFromMe: entry.message.senderId === id, lastUnreadAt: entry.lastUnreadAt,
      identity: p.identity, lastMessage: entry.message.body,
      updatedAt: entry.message.createdAt, unreadCount: entry.unread, blocked: p.blocked });
  }
  return { conversations };
}
export async function clearThread(id: string, username: string) {
  const target = await targetAccount(username);
  await db.transaction(async tx => {
    await lockPair(tx, id, target.accountId);
    await tx.update(socialMessages).set({ senderHidden: true }).where(and(eq(socialMessages.senderId, id), eq(socialMessages.recipientId, target.accountId)));
    await tx.update(socialMessages).set({ recipientHidden: true }).where(and(eq(socialMessages.recipientId, id), eq(socialMessages.senderId, target.accountId)));
  });
  return { ok: true };
}
