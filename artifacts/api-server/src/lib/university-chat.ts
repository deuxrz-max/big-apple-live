import { db, accountProfiles, chatRooms, chatModerators, socialMessages, socialSettings, socialRelations, universityIgnores, universityPreferences } from "@workspace/db";
import { and, eq, inArray, notInArray, or, desc, sql } from "drizzle-orm";
import { RoomError, roomStore } from "./room-store";
import { targetAccount, pairBlocked } from "./social/core";
import { sendMessage } from "./social/messages";
import { visibleProfilePhotos } from "./photo-visibility";
import { botRotation } from "./moderator-bots";
import { nameColorProfilesForAccounts } from "./social/gift-name-color-data";
import { passportBadgeSummaries } from "./social/passport";
import { visibleMonthlyPurchaseBadgeSummaries } from "./social/monthly-credit-badges";
import type { UniversityPerson } from "@workspace/api-zod";

export async function ignoredAccounts(id: string) {
  return (await db.select().from(universityIgnores).where(eq(universityIgnores.accountId, id))).map(r => r.targetId);
}
export async function isIgnored(id: string, target: string) {
  return (await db.select().from(universityIgnores).where(and(
    eq(universityIgnores.accountId, id), eq(universityIgnores.targetId, target),
  )).limit(1)).length > 0;
}
export async function setIgnore(id: string, username: string, active: boolean) {
  const target = await targetAccount(username);
  if (target.accountId === id) throw new RoomError(400, "You cannot ignore yourself");
  if (active) await db.insert(universityIgnores).values({ accountId: id, targetId: target.accountId }).onConflictDoNothing();
  else await db.delete(universityIgnores).where(and(eq(universityIgnores.accountId, id), eq(universityIgnores.targetId, target.accountId)));
  return { ok: true };
}
export async function markRulesSeen(id: string) {
  await db.insert(universityPreferences).values({ accountId: id, rulesSeenAt: new Date() })
    .onConflictDoUpdate({ target: universityPreferences.accountId, set: { rulesSeenAt: new Date() } });
  return { ok: true };
}
export async function universityTopic(roomId: string) {
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.roomId, roomId.toUpperCase()));
  if (!room) throw new RoomError(404, "Room not found");
  return "";
}
/** The only inline-whisper read path: membership AND sender/recipient are checked on the server. */
export async function roomWhispers(id: string, roomId: string) {
  const ignored = await ignoredAccounts(id);
  const rows = await db.select().from(socialMessages).where(and(
    eq(socialMessages.whisperHistoryId, roomStore.getHistoryId(roomId)),
    or(and(eq(socialMessages.senderId, id), eq(socialMessages.senderHidden, false)),
      and(eq(socialMessages.recipientId, id), eq(socialMessages.recipientHidden, false))),
    ignored.length ? and(notInArray(socialMessages.senderId, ignored), notInArray(socialMessages.recipientId, ignored)) : undefined,
  )).orderBy(desc(socialMessages.createdAt), desc(socialMessages.id)).limit(100);
  const result: { accountId: string; id: string; username: string; displayName: string;
    outgoing: boolean; body: string; createdAt: Date }[] = [];
  for (const row of rows.reverse()) {
    const peerId = row.senderId === id ? row.recipientId : row.senderId;
    if (await pairBlocked(id, peerId)) continue;
    const [peer] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, peerId));
    if (peer) result.push({ accountId: peerId, id: row.id, username: peer.username, displayName: peer.displayName ?? peer.username,
      outgoing: row.senderId === id, body: row.body, createdAt: row.createdAt });
  }
  const colors = await nameColorProfilesForAccounts(result.map(row => row.accountId));
  const passports = await passportBadgeSummaries(result.map(row => row.accountId));
  const badges = await visibleMonthlyPurchaseBadgeSummaries(result.map(row => row.accountId));
  return result.map(({ accountId, ...whisper }) => ({
    ...whisper, displayNameColor: colors.get(accountId)?.color ?? "#FFFFFF",
    displayNameTierIndex: colors.get(accountId)?.tierIndex ?? 0,
    badgeId: badges.get(accountId)?.tier.id ?? null,
    badgeName: badges.get(accountId)?.tier.name ?? null,
    badgeImage: badges.get(accountId)?.tier.badgeImage ?? null,
    passport: passports.get(accountId),
  }));
}
export async function universitySession(id: string, roomId: string, sessionId: string) {
  roomStore.requireAccountMember(roomId, sessionId, id);
  const snapshot = roomStore.get(roomId);
  const ignored = await ignoredAccounts(id);
  const moderators = new Set((await db.select().from(chatModerators)).map(r => r.accountId));
  const presentAccountIds = [...new Set(snapshot.participants
    .map(participant => roomStore.sessionAccountId(roomId, participant.participantId))
    .filter((accountId): accountId is string => !!accountId))];
  const nameColors = await nameColorProfilesForAccounts(presentAccountIds);
  const blockedRelations = await db.select().from(socialRelations).where(and(
    eq(socialRelations.kind, "block"),
    or(eq(socialRelations.ownerId, id), eq(socialRelations.targetId, id)),
  ));
  const blockedIds = new Set(blockedRelations.map(relation =>
    relation.ownerId === id ? relation.targetId : relation.ownerId));
  const passports = await passportBadgeSummaries(presentAccountIds);
  const badgeSummaries = await visibleMonthlyPurchaseBadgeSummaries(presentAccountIds);
  const people: UniversityPerson[] = [];
  const seen = new Set<string>();
  for (const participant of snapshot.participants) {
    const ownerId = roomStore.sessionAccountId(roomId, participant.participantId);
    if (!ownerId || seen.has(ownerId)) continue;
    seen.add(ownerId);
    const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, ownerId));
    if (!profile || (process.env.NODE_ENV === "production" && profile.isTestAccount)) continue;
    const photos = await visibleProfilePhotos(ownerId, id, profile);
    people.push({ participantId: participant.participantId, username: profile.username,
      displayName: profile.displayName ?? profile.username, photoUrl: photos.photoUrl,
      identity: {
        emojiId: profile.emojiId, gender: profile.gender, color: profile.color,
        hairColor: profile.hairColor, portraitId: profile.portraitId ?? null,
      },
      displayNameColor: nameColors.get(ownerId)?.color ?? "#FFFFFF",
      displayNameTierIndex: nameColors.get(ownerId)?.tierIndex ?? 0,
      photoStatus: photos.photoReviews?.find(r => r.photoUrl === photos.photoUrl)?.status ?? null,
      self: ownerId === id, moderator: moderators.has(ownerId), ignored: ignored.includes(ownerId),
      blocked: blockedIds.has(ownerId), botId: null,
       badgeId: badgeSummaries.get(ownerId)?.tier.id ?? null,
       badgeName: badgeSummaries.get(ownerId)?.tier.name ?? null,
       badgeImage: badgeSummaries.get(ownerId)?.tier.badgeImage ?? null,
       passport: passports.get(ownerId) });
  }
  for (const bot of botRotation.people(roomId.toUpperCase())) people.push({
    participantId: bot.participantId, username: bot.name, displayName: bot.name, photoUrl: bot.avatarUrl,
    displayNameColor: "#FFFFFF", displayNameTierIndex: 0,
    photoStatus: "approved", self: false, moderator: true, ignored: false, blocked: false, botId: bot.id,
    badgeId: null, badgeName: null, badgeImage: null,
  });
  const [prefs] = await db.select().from(universityPreferences).where(eq(universityPreferences.accountId, id));
  const ignoredNames = ignored.length
    ? (await db.select({ username: accountProfiles.username }).from(accountProfiles).where(inArray(accountProfiles.accountId, ignored))).map(r => r.username) : [];
  const result = { people, ignoredUsernames: ignoredNames, topic: await universityTopic(roomId),
    rulesSeen: !!prefs?.rulesSeenAt, whispers: await roomWhispers(id, roomId) };
  roomStore.requireAccountMember(roomId, sessionId, id);
  return result;
}
export async function sendWhisper(id: string, roomId: string, sessionId: string, username: string, body: string, key: string) {
  const check = () => { roomStore.requireAccountMember(roomId, sessionId, id); };
  check();
  return sendMessage(id, username, body, key, roomStore.getHistoryId(roomId), check);
}
