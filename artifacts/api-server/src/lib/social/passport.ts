import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  accountProfiles,
  db,
  streamerPassportAwards,
  streamerPassportLinks,
} from "@workspace/db";
import { requireModerator } from "../community";
import { RoomError } from "../room-store";
import { pairBlocked, targetAccount } from "./core";
import { privatePassportEntry as privateLink, parsePlatformValue, passportPlatformFor, type PassportBadgeSummary, PassportInputError, publicPassportEntry, reviewState, STREAMER_PASSPORT_PLATFORMS, verificationCode } from "./passport-policy";

export async function myStreamerPassport(accountId: string) {
  const [links, award] = await Promise.all([
    db.select().from(streamerPassportLinks).where(eq(streamerPassportLinks.accountId, accountId))
      .orderBy(asc(streamerPassportLinks.addedAt), asc(streamerPassportLinks.platform)),
    db.select({ accountId: streamerPassportAwards.accountId }).from(streamerPassportAwards)
      .where(eq(streamerPassportAwards.accountId, accountId)).limit(1),
  ]);
  return {
    availablePlatforms: STREAMER_PASSPORT_PLATFORMS.map(({ id, label, color }) => ({ id, label, color })),
    platforms: links.map(privateLink).filter((entry): entry is NonNullable<typeof entry> => !!entry),
    foundingLeague: award.length > 0,
  };
}

export async function savePassportPlatform(accountId: string, platformId: string, handleOrUrl: string) {
  let parsed: ReturnType<typeof parsePlatformValue>;
  try { parsed = parsePlatformValue(platformId, handleOrUrl); }
  catch (error) {
    if (error instanceof PassportInputError) throw new RoomError(400, error.message);
    throw error;
  }
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`);
    const [existing] = await tx.select().from(streamerPassportLinks).where(and(
      eq(streamerPassportLinks.accountId, accountId), eq(streamerPassportLinks.platform, parsed.platform.id),
    )).limit(1);
    if (existing && existing.handle === parsed.handle && existing.profileUrl === parsed.profileUrl) return privateLink(existing);
    if (existing) {
      const [updated] = await tx.update(streamerPassportLinks).set({
        handle: parsed.handle,
        profileUrl: parsed.profileUrl,
        verificationCode: verificationCode(),
        verificationStatus: "unverified",
        requestedAt: null,
        verifiedAt: null,
        verifiedBy: null,
      }).where(eq(streamerPassportLinks.id, existing.id)).returning();
      return privateLink(updated!);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const [created] = await tx.insert(streamerPassportLinks).values({
        accountId, platform: parsed.platform.id, handle: parsed.handle,
        profileUrl: parsed.profileUrl, verificationCode: verificationCode(),
      }).onConflictDoNothing().returning();
      if (created) return privateLink(created);
      const [raced] = await tx.select().from(streamerPassportLinks).where(and(
        eq(streamerPassportLinks.accountId, accountId), eq(streamerPassportLinks.platform, parsed.platform.id),
      )).limit(1);
      if (raced) return privateLink(raced);
    }
    throw new RoomError(409, "Could not allocate a unique verification code. Try again.");
  });
}

export async function deletePassportPlatform(accountId: string, entryId: string) {
  const deleted = await db.delete(streamerPassportLinks).where(and(
    eq(streamerPassportLinks.id, entryId), eq(streamerPassportLinks.accountId, accountId),
  )).returning({ id: streamerPassportLinks.id });
  if (!deleted.length) throw new RoomError(404, "Platform link not found");
  return { ok: true };
}

export async function requestPassportVerification(accountId: string, entryId: string) {
  const [link] = await db.select().from(streamerPassportLinks).where(and(
    eq(streamerPassportLinks.id, entryId), eq(streamerPassportLinks.accountId, accountId),
  )).limit(1);
  if (!link) throw new RoomError(404, "Platform link not found");
  if (link.verificationStatus === "verified") throw new RoomError(409, "This platform is already verified");
  const [updated] = await db.update(streamerPassportLinks).set({
    verificationStatus: "requested", requestedAt: new Date(),
  }).where(eq(streamerPassportLinks.id, entryId)).returning();
  return privateLink(updated!);
}

export async function publicStreamerPassport(viewerId: string, username: string) {
  const target = await targetAccount(username);
  if (target.accountId !== viewerId && await pairBlocked(viewerId, target.accountId))
    throw new RoomError(404, "Profile unavailable");
  const [profile] = await db.select().from(accountProfiles).where(and(
    eq(accountProfiles.accountId, target.accountId),
    process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined,
  )).limit(1);
  if (!profile) throw new RoomError(404, "Profile unavailable");
  const [links, award] = await Promise.all([
    db.select().from(streamerPassportLinks).where(eq(streamerPassportLinks.accountId, target.accountId))
      .orderBy(asc(streamerPassportLinks.addedAt), asc(streamerPassportLinks.platform)),
    db.select({ accountId: streamerPassportAwards.accountId }).from(streamerPassportAwards)
      .where(eq(streamerPassportAwards.accountId, target.accountId)).limit(1),
  ]);
  return {
    username: profile.username,
    displayName: profile.displayName ?? profile.username,
    identity: { emojiId: profile.emojiId, gender: profile.gender, color: profile.color, hairColor: profile.hairColor, portraitId: profile.portraitId ?? null },
    platforms: links.flatMap(row => {
      const entry = publicPassportEntry(row);
      return entry ? [entry] : [];
    }),
    foundingLeague: award.length > 0,
  };
}

export async function passportBadgeSummaries(accountIds: string[]): Promise<Map<string, PassportBadgeSummary>> {
  const ids = [...new Set(accountIds)];
  if (!ids.length) return new Map();
  const [links, awards] = await Promise.all([
    db.select({
      accountId: streamerPassportLinks.accountId,
      platform: streamerPassportLinks.platform,
      verificationStatus: streamerPassportLinks.verificationStatus,
    }).from(streamerPassportLinks).innerJoin(accountProfiles, eq(accountProfiles.accountId, streamerPassportLinks.accountId))
      .where(and(inArray(streamerPassportLinks.accountId, ids),
        process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined)),
    db.select({ accountId: streamerPassportAwards.accountId }).from(streamerPassportAwards).innerJoin(
      accountProfiles, eq(accountProfiles.accountId, streamerPassportAwards.accountId),
    ).where(and(inArray(streamerPassportAwards.accountId, ids),
      process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined)),
  ]);
  const awarded = new Set(awards.map(row => row.accountId));
  const result = new Map<string, PassportBadgeSummary>();
  for (const row of links) {
    const platform = passportPlatformFor(row.platform);
    if (!platform) continue;
    const summary = result.get(row.accountId) ?? { platforms: [], verified: false, foundingLeague: awarded.has(row.accountId) };
    if (!summary.platforms.some(item => item.id === platform.id))
      summary.platforms.push({ id: platform.id, label: platform.label, color: platform.color });
    summary.verified ||= row.verificationStatus === "verified";
    result.set(row.accountId, summary);
  }
  for (const accountId of awarded) {
    if (!result.has(accountId)) result.set(accountId, { platforms: [], verified: false, foundingLeague: true });
  }
  return result;
}

async function requirePassportModerator(accountId: string) {
  await requireModerator(accountId);
}

export async function passportReviewQueue(accountId: string) {
  await requirePassportModerator(accountId);
  const rows = await db.select({ link: streamerPassportLinks, username: accountProfiles.username, displayName: accountProfiles.displayName })
    .from(streamerPassportLinks).innerJoin(accountProfiles, eq(accountProfiles.accountId, streamerPassportLinks.accountId))
    .where(and(eq(streamerPassportLinks.verificationStatus, "requested"),
      process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined))
    .orderBy(asc(streamerPassportLinks.requestedAt), asc(streamerPassportLinks.addedAt));
  return { requests: rows.flatMap(row => {
    const link = privateLink(row.link);
    return link ? [{ ...link, username: row.username, displayName: row.displayName ?? row.username }] : [];
  }) };
}

export async function reviewPassportRequest(moderatorId: string, entryId: string, action: "approve" | "reject") {
  await requirePassportModerator(moderatorId);
  const [current] = await db.select().from(streamerPassportLinks).where(and(
    eq(streamerPassportLinks.id, entryId), eq(streamerPassportLinks.verificationStatus, "requested"),
  )).limit(1);
  if (!current) throw new RoomError(404, "Verification request not found");
  if (process.env.NODE_ENV === "production") {
    const [profile] = await db.select({ isTestAccount: accountProfiles.isTestAccount }).from(accountProfiles)
      .where(eq(accountProfiles.accountId, current.accountId)).limit(1);
    if (profile?.isTestAccount) throw new RoomError(404, "Verification request not found");
  }
  await db.update(streamerPassportLinks).set(reviewState(action, moderatorId)).where(eq(streamerPassportLinks.id, entryId));
  return { ok: true };
}

export async function setFoundingLeague(moderatorId: string, username: string, grant: boolean) {
  await requirePassportModerator(moderatorId);
  const target = await targetAccount(username);
  if (process.env.NODE_ENV === "production") {
    const [profile] = await db.select({ isTestAccount: accountProfiles.isTestAccount }).from(accountProfiles)
      .where(eq(accountProfiles.accountId, target.accountId)).limit(1);
    if (profile?.isTestAccount) throw new RoomError(404, "Account not found");
  }
  if (grant) await db.insert(streamerPassportAwards).values({
    accountId: target.accountId, awardId: "founding-league", grantedBy: moderatorId,
  }).onConflictDoNothing();
  else await db.delete(streamerPassportAwards).where(eq(streamerPassportAwards.accountId, target.accountId));
  return { ok: true };
}

