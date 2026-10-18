import { db, accountProfiles, moderatorBotAccounts, moderatorBotSettings, moderatorBotChatterSettings, moderatorBotFlags, roomMessages, chatRooms } from "@workspace/db";
import { nameColorProfilesForAccounts } from "./social/gift-name-color-data";
import { and, eq, desc, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import type { UniversityVideoBeamTvVideoMetadata } from "@workspace/api-zod";
import { roomStore } from "./room-store";
import { BOT_ACCOUNTS, BotRotation, DEFAULT_BANNED_WORDS, DEFAULT_BOT_BREAK_SECONDS, publicViolation, type Bot, type BotId } from "./bot-policy";
import { universityVideoBeamStore } from "./university-video-beam";
import { beamTvReactionLine } from "./beam-tv-reaction-policy";
import {
  chooseBotChatterLine, DEFAULT_BOT_CHATTER_SETTINGS, hasRecentHumanRoomActivity,
  nextBotChatterDelayMs, type BotChatterSettings,
} from "./bot-chatter-policy";

export const botRotation = new BotRotation();
export const BOT_MESSAGE_IDENTITY = { emojiId: "system", gender: "Male" as const, color: "#9D1DFF", hairColor: "#151518" };
let settingsCache: { bannedWords: string[]; breakSeconds: number; at: number } | null = null;
let chatterCache: { settings: BotChatterSettings; at: number } | null = null;
let resetChatterSchedule: ((enabled: boolean, frequency: BotChatterSettings["frequency"]) => void) | null = null;
const BOT_CHATTER_ROW_ID = "streamtalk";
let beamTvReactionProcessing = false;
type BeamTvReaction = {
  videoId: string;
  metadata: UniversityVideoBeamTvVideoMetadata | null;
  startDueAt: number;
  startDeadline: number;
  followUpAt: number;
  lastPlaybackAt: number;
  startSent: boolean;
  followUpSent: boolean;
  lastText: string | null;
};
const beamTvReactions = new Map<string, BeamTvReaction>();
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
export function botMessageValues(
  bot: Bot, roomId: string, historyId: string, text: string,
  botMessageType: "chatter" | "moderation" | "visit" = "moderation",
) {
  return { roomId, historyId, authorId: bot.participantId, authorAccountId: null, botId: bot.id,
    botMessageType, username: bot.name, identity: BOT_MESSAGE_IDENTITY, kind: "text" as const, text };
}
export function scheduleBeamTvVideoStart(
  roomId: string,
  videoId: string,
  metadata?: UniversityVideoBeamTvVideoMetadata,
  force = false,
) {
  const key = roomId.toUpperCase();
  const previous = beamTvReactions.get(key);
  if (previous?.videoId === videoId && !force) {
    if (metadata) previous.metadata = metadata;
    return;
  }
  const now = Date.now();
  beamTvReactions.set(key, {
    videoId,
    metadata: metadata ?? null,
    startDueAt: now + 9_000 + Math.floor(Math.random() * 9_000),
    startDeadline: now + 120_000,
    followUpAt: now + 4 * 60_000 + Math.floor(Math.random() * 4 * 60_000),
    lastPlaybackAt: 0,
    startSent: false,
    followUpSent: false,
    lastText: previous?.lastText ?? null,
  });
}
export function updateBeamTvVideoMetadata(roomId: string, metadata: UniversityVideoBeamTvVideoMetadata) {
  const pending = beamTvReactions.get(roomId.toUpperCase());
  if (!pending || pending.videoId !== metadata.videoId) return;
  pending.metadata = metadata;
  pending.lastPlaybackAt = Date.now();
}
async function roomHasRecentHumanChat(roomId: string, historyId: string, now: number) {
  const activeAccountIds = roomStore.activeAccountIds(roomId);
  if (!activeAccountIds.length) return false;
  const [activeRealAccount] = await db.select({ accountId: accountProfiles.accountId })
    .from(accountProfiles)
    .where(and(
      inArray(accountProfiles.accountId, activeAccountIds),
      eq(accountProfiles.isTestAccount, false),
    )).limit(1);
  if (!activeRealAccount) return false;
  const [lastHuman] = await db.select({ createdAt: roomMessages.createdAt })
    .from(roomMessages).innerJoin(accountProfiles, eq(roomMessages.authorAccountId, accountProfiles.accountId))
    .where(and(
      eq(roomMessages.roomId, roomId),
      eq(roomMessages.historyId, historyId),
      eq(roomMessages.hidden, "false"),
      eq(roomMessages.kind, "text"),
      isNull(roomMessages.botId),
      isNotNull(roomMessages.authorAccountId),
      inArray(roomMessages.authorAccountId, activeAccountIds),
      eq(accountProfiles.isTestAccount, false),
      gt(roomMessages.createdAt, new Date(now - 90_000)),
    ))
    .orderBy(desc(roomMessages.createdAt)).limit(1);
  return Boolean(lastHuman);
}
async function roomHasRecentBotMessage(roomId: string, historyId: string, now: number) {
  const [lastBot] = await db.select({ id: roomMessages.id })
    .from(roomMessages)
    .where(and(
      eq(roomMessages.roomId, roomId),
      eq(roomMessages.historyId, historyId),
      eq(roomMessages.hidden, "false"),
      isNotNull(roomMessages.botId),
      gt(roomMessages.createdAt, new Date(now - 90_000)),
    ))
    .orderBy(desc(roomMessages.createdAt)).limit(1);
  return Boolean(lastBot);
}
async function processBeamTvReactions(settings: BotChatterSettings, now: number): Promise<boolean> {
  if (beamTvReactionProcessing) return false;
  beamTvReactionProcessing = true;
  try {
  let posted = false;
  for (const [roomId, pending] of beamTvReactions) {
    let tv;
    try { tv = universityVideoBeamStore.getState(roomId).tv; }
    catch { beamTvReactions.delete(roomId); continue; }
    if (!tv.enabled || tv.currentVideoId !== pending.videoId) {
      beamTvReactions.delete(roomId);
      continue;
    }
    if (now - pending.lastPlaybackAt > 45_000) continue;

    const shouldPostStart = !pending.startSent && now >= pending.startDueAt;
    const shouldPostFollowUp = pending.startSent && !pending.followUpSent && now >= pending.followUpAt;
    if (!shouldPostStart && !shouldPostFollowUp) continue;
    if (shouldPostStart && now > pending.startDeadline) {
      pending.startSent = true;
      continue;
    }

    const historyId = roomStore.getHistoryId(roomId);
    const activeAccountIds = roomStore.activeAccountIds(roomId);
    const [activeRealAccount] = activeAccountIds.length
      ? await db.select({ accountId: accountProfiles.accountId }).from(accountProfiles)
        .where(and(
          inArray(accountProfiles.accountId, activeAccountIds),
          eq(accountProfiles.isTestAccount, false),
        )).limit(1)
      : [];
    if (!activeRealAccount) {
      if (shouldPostStart && now > pending.startDeadline) pending.startSent = true;
      continue;
    }
    if (await roomHasRecentHumanChat(roomId, historyId, now) ||
        await roomHasRecentBotMessage(roomId, historyId, now)) {
      if (shouldPostStart) pending.startDueAt = now + 35_000;
      else pending.followUpAt = now + 45_000;
      continue;
    }

    const profiles = settings.bots;
    const candidates = [...profiles].sort(() => Math.random() - 0.5);
    let chosen: { profile: BotChatterSettings["bots"][number]; text: string; bot: Bot } | undefined;
    const bannedWords = (await botSettings()).bannedWords;
    for (const profile of candidates) {
      const text = beamTvReactionLine(profile.id, pending.metadata);
      if (text === pending.lastText || publicViolation(text, bannedWords, [], now)) continue;
      const bot = botRotation.botById(profile.id);
      chosen = { profile, text, bot: { ...bot, name: profile.name } };
      break;
    }
    if (!chosen) {
      if (shouldPostStart) pending.startSent = true;
      else pending.followUpSent = true;
      continue;
    }
    await db.insert(roomMessages).values(botMessageValues(chosen.bot, roomId, historyId, chosen.text, "chatter"));
    roomStore.refreshRoomChat(roomId);
    pending.lastText = chosen.text;
    if (shouldPostStart) pending.startSent = true;
    else pending.followUpSent = true;
    posted = true;
  }
  return posted;
  } finally {
    beamTvReactionProcessing = false;
  }
}
export async function postBeamTvVoteAnnouncement(roomId: string) {
  const settings = await botChatterSettings();
  const profile = settings.bots[Math.floor(Math.random() * settings.bots.length)]!;
  const bot = botRotation.botById(profile.id);
  await db.insert(roomMessages).values(botMessageValues(
    { ...bot, name: profile.name },
    roomId.toUpperCase(),
    roomStore.getHistoryId(roomId),
    "The room voted: next video.",
    "chatter",
  ));
  roomStore.refreshRoomChat(roomId);
}
function namesById(settings: BotChatterSettings): Partial<Record<BotId, string>> {
  return Object.fromEntries(settings.bots.map(bot => [bot.id, bot.name])) as Partial<Record<BotId, string>>;
}
function syncBotNames(settings: BotChatterSettings) {
  botRotation.setDisplayNames(namesById(settings));
}
export async function botChatterSettings(): Promise<BotChatterSettings> {
  if (chatterCache && Date.now() - chatterCache.at < 3000) return chatterCache.settings;
  const [row] = await db.select().from(moderatorBotChatterSettings).where(eq(moderatorBotChatterSettings.id, BOT_CHATTER_ROW_ID));
  const settings = row
    ? { enabled: row.enabled, frequency: row.frequency, bots: row.bots }
    : DEFAULT_BOT_CHATTER_SETTINGS;
  chatterCache = { settings, at: Date.now() };
  syncBotNames(settings);
  return settings;
}
export async function saveBotChatterSettings(settings: BotChatterSettings) {
  await db.insert(moderatorBotChatterSettings)
    .values({ id: BOT_CHATTER_ROW_ID, ...settings, updatedAt: new Date() })
    .onConflictDoUpdate({ target: moderatorBotChatterSettings.id, set: { ...settings, updatedAt: new Date() } });
  for (const bot of settings.bots) {
    await db.update(moderatorBotAccounts).set({ name: bot.name }).where(eq(moderatorBotAccounts.id, bot.id));
  }
  chatterCache = null;
  syncBotNames(settings);
  resetChatterSchedule?.(settings.enabled, settings.frequency);
  return botChatterSettings();
}
export async function initializeModeratorBots() {
  for (const bot of BOT_ACCOUNTS) await db.insert(moderatorBotAccounts)
    .values({ id: bot.id, name: bot.name, avatarUrl: bot.avatarUrl }).onConflictDoNothing();
  await db.insert(moderatorBotSettings).values({ id: "streamtalk",
    bannedWords: DEFAULT_BANNED_WORDS, breakSeconds: DEFAULT_BOT_BREAK_SECONDS }).onConflictDoNothing();
  await db.insert(moderatorBotChatterSettings).values({ id: BOT_CHATTER_ROW_ID, ...DEFAULT_BOT_CHATTER_SETTINGS })
    .onConflictDoNothing();
  chatterCache = null;
  const chatter = await botChatterSettings();
  for (const bot of chatter.bots) {
    await db.update(moderatorBotAccounts).set({ name: bot.name }).where(eq(moderatorBotAccounts.id, bot.id));
  }
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
            roomStore.getHistoryId(event.roomId), event.type === "join" ? event.bot.arrival : event.bot.departure, "visit"));
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
export function startModeratorBotChatter(onError: (err: unknown, context: { roomId?: string }) => void) {
  let nextAt = 0;
  let working = false;
  resetChatterSchedule = (enabled, frequency) => {
    nextAt = enabled ? Date.now() + nextBotChatterDelayMs(frequency) : 0;
  };
  const timer = setInterval(() => {
    if (working) return;
    working = true;
    void (async () => {
      const now = Date.now();
      const settings = await botChatterSettings();
      if (!settings.enabled) {
        beamTvReactions.clear();
        nextAt = 0;
        return;
      }
      if (await processBeamTvReactions(settings, now)) {
        nextAt = now + nextBotChatterDelayMs(settings.frequency);
        return;
      }
      if (!nextAt) { nextAt = now + nextBotChatterDelayMs(settings.frequency); return; }
      if (now < nextAt) return;

      const rooms = roomStore.occupiedUniversities();
      if (!rooms.length) { nextAt = now + 30_000; return; }
      const [lastChatter] = await db.select({ text: roomMessages.text })
        .from(roomMessages).where(eq(roomMessages.botMessageType, "chatter"))
        .orderBy(desc(roomMessages.createdAt)).limit(1);
      const [lastBotMessage] = await db.select({ createdAt: roomMessages.createdAt })
        .from(roomMessages).where(and(isNotNull(roomMessages.botId), eq(roomMessages.hidden, "false")))
        .orderBy(desc(roomMessages.createdAt)).limit(1);
      const latestBotMessageAt = lastBotMessage?.createdAt ?? null;
      const activeRooms: { roomId: string; historyId: string }[] = [];
      for (const roomId of rooms) {
        const historyId = roomStore.getHistoryId(roomId);
        const [lastHuman] = await db.select({ createdAt: roomMessages.createdAt })
          .from(roomMessages).innerJoin(accountProfiles, eq(roomMessages.authorAccountId, accountProfiles.accountId))
          .where(and(
            eq(roomMessages.roomId, roomId),
            eq(roomMessages.historyId, historyId),
            eq(roomMessages.hidden, "false"),
            eq(roomMessages.kind, "text"),
            isNull(roomMessages.botId),
            eq(accountProfiles.isTestAccount, false),
            isNotNull(roomMessages.authorAccountId),
            ...(latestBotMessageAt ? [gt(roomMessages.createdAt, latestBotMessageAt)] : []),
          ))
          .orderBy(desc(roomMessages.createdAt)).limit(1);
        if (hasRecentHumanRoomActivity(lastHuman?.createdAt ?? null, now, latestBotMessageAt)) {
          activeRooms.push({ roomId, historyId });
        }
      }
      if (!activeRooms.length) { nextAt = now + 30_000; return; }

      const room = activeRooms[Math.floor(Math.random() * activeRooms.length)]!;
      const profile = settings.bots[Math.floor(Math.random() * settings.bots.length)]!;
      const line = chooseBotChatterLine(profile.lines, lastChatter?.text ?? null);
      if (!line) { nextAt = now + 30_000; return; }
      const bot = botRotation.botById(profile.id);
      await db.insert(roomMessages).values(botMessageValues({ ...bot, name: profile.name }, room.roomId,
        room.historyId, line, "chatter"));
      roomStore.refreshRoomChat(room.roomId);
      nextAt = now + nextBotChatterDelayMs(settings.frequency);
    })().catch(err => onError(err, {})).finally(() => { working = false; });
  }, 15_000);
  timer.unref();
  return () => { clearInterval(timer); resetChatterSchedule = null; };
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
  const colors = await nameColorProfilesForAccounts(rows.map(row => row.accountId));
  return rows.map(({ accountId, ...flag }) => ({
    ...flag, displayNameColor: colors.get(accountId)?.color ?? "#FFFFFF",
    displayNameTierIndex: colors.get(accountId)?.tierIndex ?? 0,
  }));
}
export async function reviewBotFlag(id: string, reviewer: string) {
  const [updated] = await db.update(moderatorBotFlags).set({ reviewedAt: new Date(), reviewedBy: reviewer })
    .where(and(eq(moderatorBotFlags.id, id), isNull(moderatorBotFlags.reviewedAt))).returning();
  return updated;
}
