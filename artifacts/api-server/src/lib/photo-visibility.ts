import { and, eq, inArray, sql } from "drizzle-orm";
import { db, profilePhotos, accountProfiles, chatModerators } from "@workspace/db";
import { nameColorProfilesForAccounts } from "./social/gift-name-color-data";

export type PhotoStatus = "pending" | "approved" | "rejected" | "flagged";
export function photoIdFromUrl(url: string | null | undefined) {
  return /^\/api\/photos\/([a-f0-9-]{36})$/.exec(url ?? "")?.[1];
}
/** Public profiles only expose approved saved photos. Unknown legacy URLs fail closed. */
export async function visibleProfilePhotos(
  ownerId: string, viewerId: string | undefined,
  profile: { photoUrl: string | null; photoUrls?: string[] },
) {
  if (process.env.NODE_ENV === "production") {
    const [owner] = await db.select({ isTestAccount: accountProfiles.isTestAccount }).from(accountProfiles)
      .where(eq(accountProfiles.accountId, ownerId));
    if (owner?.isTestAccount) return {
      photoUrl: null, photoUrls: [],
      ...(ownerId === viewerId ? { photoReviews: [] } : {}),
    };
  }
  const urls = profile.photoUrls?.length ? profile.photoUrls : profile.photoUrl ? [profile.photoUrl] : [];
  const ids = urls.map(photoIdFromUrl).filter((id): id is string => !!id);
  const photos = ids.length ? await db.select().from(profilePhotos).where(and(
    eq(profilePhotos.accountId, ownerId), inArray(profilePhotos.id, ids),
  )) : [];
  const own = ownerId === viewerId;
  const available = photos.filter(p => !p.deletionStartedAt && (own || p.status === "approved"));
  const allowed = new Set(available.map(p => `/api/photos/${p.id}`));
  return {
    photoUrl: profile.photoUrl && allowed.has(profile.photoUrl) ? profile.photoUrl : null,
    photoUrls: urls.filter(url => allowed.has(url)),
    ...(own ? { photoReviews: available.map(p => ({ photoUrl: `/api/photos/${p.id}`, status: p.status })) } : {}),
  };
}
export async function canReviewPhotos(viewerId: string) {
  const [mod] = await db.select().from(chatModerators).where(eq(chatModerators.accountId, viewerId));
  return !!mod;
}
export async function pendingPhotoQueue() {
  const rows = await db.select({
    id: profilePhotos.id, status: profilePhotos.status, createdAt: profilePhotos.createdAt,
    accountId: accountProfiles.accountId,
    username: accountProfiles.username, displayName: accountProfiles.displayName,
    photoUrl: sql<string>`'/api/photos/' || ${profilePhotos.id}::text`,
  }).from(profilePhotos).leftJoin(accountProfiles, eq(accountProfiles.accountId, profilePhotos.accountId))
    .where(and(eq(profilePhotos.status, "pending"), sql`${profilePhotos.deletionStartedAt} IS NULL`,
      process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined))
    .orderBy(profilePhotos.createdAt).limit(100);
  const colors = await nameColorProfilesForAccounts(rows.map(row => row.accountId).filter((id): id is string => !!id));
  return rows.map(({ accountId, ...photo }) => ({
    ...photo, displayNameColor: accountId ? colors.get(accountId)?.color ?? "#FFFFFF" : "#FFFFFF",
    displayNameTierIndex: accountId ? colors.get(accountId)?.tierIndex ?? 0 : 0,
  }));
}
