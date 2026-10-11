import { db, moderatorBotAccounts, moderatorBotSettings, moderatorBotFlags, roomMessages, chatRooms } from "@workspace/db";
import { giftNameColorsForAccounts } from "./social/gift-name-color-data";
import { and, eq, desc, isNull } from "drizzle-orm";
import { roomStore } from "./room-store";
import { BOT_ACCOUNTS, BotRotation, DEFAULT_BANNED_WORDS, DEFAULT_BOT_BREAK_SECONDS, type Bot } from "./bot-policy";

export const botRotation = new BotRotation();
export const BOT_MESSAGE_IDENTITY = { emojiId: "system", gender: "Male" as const, color: "#9D1DFF", hairColor: "#151518" };
let settingsCache: { bannedWords: string[]; breakSeconds: number; at: number } | null = null;
export async function botSettings() {
  if (settingsCache && Date.now() - settingsCache.at < 3000) return settingsCache;
  const [row] = await db.select().from(moderatorBotSettings).where(eq(moderatorBotSettings.id, "streamtalk"));
  const result = row ?? { bannedWords: DEFAULT_BANNED_WORDS, breakSeconds: DEFAULT_BOT_BREAK_SECONDS };
  settingsCache = { bannedWords: result.bannedWords, breakSeconds: result.breakSeconds, at: Date.now() };
  return settingsCache;
}
export async function saveBotSettings(data: { bannedWords: string[]; breakSeconds: number }) {
  await db.insert(moderatorBotSettings).values({ id: "streamtalk", ...data })
    .onConflictDoUpdate({ target: moderatorBotSettings.id, set: data });
  settingsCache = null;
  const settings = await botSettings();
  return { bannedWords: settings.bannedWords, breakSeconds: settings.breakSeconds };
}
export function botMessageValues(bot: Bot, roomId: string, historyId: string, text: string) {
  return { roomId, historyId, authorId: bot.participantId, authorAccountId: null, botId: bot.id,
    username: bot.name, identity: BOT_MESSAGE_IDENTITY, kind: "text" as const, text };
}
export async function initializeModeratorBots() {
  for (const bot of BOT_ACCOUNTS) await db.insert(moderatorBotAccounts)
    .values({ id: bot.id, name: bot.name, avatarUrl: bot.avatarUrl }).onConflictDoNothing();
  await db.insert(moderatorBotSettings).values({ id: "streamtalk",
    bannedWords: DEFAULT_BANNED_WORDS, breakSeconds: DEFAULT_BOT_BREAK_SECONDS }).onConflictDoNothing();
}
export function startModeratorBotRotation(onError: (err: unknown, context: { botId?: string; roomId?: string }) => void) {
  let working = false;
  const timer = setInterval(() => {
    if (working) return;
    working = true;
    void (async () => {
      const settings = await botSettings();
      for (const event of botRotation.tick(roomStore.occupiedUniversities(), Date.now(), settings.breakSeconds)) {
        try {
          await db.insert(roomMessages).values(botMessageValues(event.bot, event.roomId,
            roomStore.getHistoryId(event.roomId), event.type === "join" ? event.bot.arrival : event.bot.departure));
          roomStore.refreshRoomChat(event.roomId);
        } catch (err) {
          if (event.type === "join") botRotation.cancelJoin(event.bot.id, Date.now());
          onError(err, { botId: event.bot.id, roomId: event.roomId });
        }
      }
    })().catch(err => onError(err, {})).finally(() => { working = false; });
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
export async function getBotFlags() {
  const rows = await db.select({ id: moderatorBotFlags.id, messageId: moderatorBotFlags.messageId,
    accountId: moderatorBotFlags.accountId,
    roomId: moderatorBotFlags.roomId, roomLabel: chatRooms.label, username: moderatorBotFlags.username,
    displayName: moderatorBotFlags.displayName, reason: moderatorBotFlags.reason, text: roomMessages.text,
    createdAt: moderatorBotFlags.createdAt, reviewedAt: moderatorBotFlags.reviewedAt })
    .from(moderatorBotFlags).innerJoin(roomMessages, eq(roomMessages.id, moderatorBotFlags.messageId))
    .innerJoin(chatRooms, eq(chatRooms.roomId, moderatorBotFlags.roomId))
    .where(isNull(moderatorBotFlags.reviewedAt)).orderBy(desc(moderatorBotFlags.createdAt)).limit(100);
  const colors = await giftNameColorsForAccounts(rows.map(row => row.accountId));
  return rows.map(({ accountId, ...flag }) => ({
    ...flag, displayNameColor: colors.get(accountId) ?? "#FFFFFF",
  }));
}
export async function reviewBotFlag(id: string, reviewer: string) {
  const [updated] = await db.update(moderatorBotFlags).set({ reviewedAt: new Date(), reviewedBy: reviewer })
    .where(and(eq(moderatorBotFlags.id, id), isNull(moderatorBotFlags.reviewedAt))).returning();
  return updated;
}
