import { db, accountProfiles, socialSettings, profilePhotos, type AccountProfileRow } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import type { AccountProfile, ProfileInput } from "@workspace/api-zod";
import { RoomError, roomStore } from "./room-store";
import { visibleProfilePhotos } from "./photo-visibility";
import { deleteReplacedProfilePhoto } from "./profile-photo-storage";

export function publicProfile(row: AccountProfileRow): AccountProfile {
  return {
    username: row.username,
    displayName: row.displayName ?? row.username,
    photoUrl: row.photoUrl ?? null,
    photoUrls: profilePhotoUrls(row),
    identity: {
      emojiId: row.emojiId, gender: row.gender, color: row.color, hairColor: row.hairColor,
      ...(row.portraitId ? { portraitId: row.portraitId } : {}),
      ...(row.currentMood ? { currentMood: row.currentMood as AccountProfile["identity"]["currentMood"] } : {}),
    },
    updatedAt: row.updatedAt,
  };
}
export function profilePhotoUrls(row: { photoUrl?: string | null; photoUrls?: string[] }): string[] {
  return row.photoUrls?.length ? [...row.photoUrls] : row.photoUrl ? [row.photoUrl] : [];
}
export async function isTestAccountId(accountId: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  const [row] = await db.select({ isTestAccount: accountProfiles.isTestAccount }).from(accountProfiles)
    .where(eq(accountProfiles.accountId, accountId));
  return !!row?.isTestAccount;
}
export async function getProfile(accountId: string): Promise<AccountProfile | null> {
  const [row] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
  if (!row || (process.env.NODE_ENV === "production" && row.isTestAccount)) return null;
  const photos = await visibleProfilePhotos(accountId, accountId, row);
  const photoUrl = photos.photoUrl ?? null;
  return { ...publicProfile(row), photoUrl, photoUrls: photoUrl ? [photoUrl] : [],
    photoReviews: photos.photoReviews?.filter(photo => photo.photoUrl === photoUrl) ?? [] };
}
export async function requireCompletedProfile(accountId: string): Promise<AccountProfile> {
  const profile = await getProfile(accountId);
  if (!profile) throw new RoomError(409, "Complete your profile before entering a room");
  return profile;
}
export async function ensureGuestNameAvailable(name: string): Promise<void> {
  const [row] = await db.select({ name: accountProfiles.username }).from(accountProfiles)
    .where(eq(accountProfiles.nameKey, name.trim().toLowerCase())).limit(1);
  if (row) throw new RoomError(409, "This name is reserved by an account; sign in to use your dedicated name");
}
export async function saveProfile(accountId: string, input: ProfileInput): Promise<AccountProfile> {
  if (process.env.NODE_ENV === "production") {
    const [existing] = await db.select({ isTestAccount: accountProfiles.isTestAccount })
      .from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
    if (existing?.isTestAccount) throw new RoomError(404, "Account profile not available");
  }
  const displayName = input.displayName?.trim();
  if (displayName !== undefined && (!displayName || displayName.length > 40))
    throw new RoomError(400, "Display name must contain 1–40 characters");
  const nameKey = input.username.toLowerCase();
  try {
    const saved = await db.transaction(async (tx) => {
      // Serialize first-claim/edit for the same account. The unique name index
      // independently protects concurrent claims by different accounts.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`);
      const [existing] = await tx.select().from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
      if (existing && existing.nameKey !== nameKey) throw new RoomError(409, "Your dedicated name is permanent");
      const previous = existing ? profilePhotoUrls(existing) : [];
      let selected = input.photoUrls !== undefined ? [...input.photoUrls] : previous.slice(0, 1);
      // A profile may keep only one photo; selecting or removing it replaces the previous file.
      if (input.photoUrls === undefined && input.photoUrl !== undefined && input.photoUrl !== existing?.photoUrl) {
        selected = selected.filter(url => url !== existing?.photoUrl);
        if (input.photoUrl && !selected.includes(input.photoUrl)) selected.unshift(input.photoUrl);
      }
      if (selected.length > 1) throw new RoomError(400, "Keep one profile photo. Upload a replacement instead.");
      if (new Set(selected).size !== selected.length) throw new RoomError(400, "Each profile photo must be different");
      let main = input.photoUrl !== undefined ? input.photoUrl : existing?.photoUrl ?? null;
      if (!selected.length) {
        if (main && input.photoUrls !== undefined && input.photoUrl !== undefined)
          throw new RoomError(400, "Your main photo must be one of your saved profile photos");
        main = null;
      } else if (!main || !selected.includes(main)) {
        if (input.photoUrls !== undefined && input.photoUrl !== undefined)
          throw new RoomError(400, "Choose a main photo from your saved profile photos");
        main = selected[0]!;
      }
      for (const url of selected) {
       // Preserve the one existing photo when only the display name changes.
        if (input.photoUrls === undefined && input.photoUrl === undefined && previous.includes(url)) continue;
        const match = /^\/api\/photos\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(url);
        if (!match) throw new RoomError(400, "Upload a photo here before saving it");
        const [owned] = await tx.select().from(profilePhotos).where(and(
          eq(profilePhotos.id, match[1]!), eq(profilePhotos.accountId, accountId)));
        if (!owned) throw new RoomError(403, "You can save only your own uploaded photo");
        if (owned.deletionStartedAt) throw new RoomError(409, "This uploaded photo has expired; upload it again");
      }
      const values = {
        updatedAt: new Date(),
        ...(displayName !== undefined ? { displayName } : {}),
        photoUrl: main,
        photoUrls: selected,
      };
      const [row] = existing
        ? await tx.update(accountProfiles).set(values).where(eq(accountProfiles.accountId, accountId)).returning()
        : await tx.insert(accountProfiles).values({ ...values, accountId, username: input.username, nameKey,
          // Compatibility-only NOT NULL columns; never selected/rendered or mood-synced.
          emojiId: "1F600", gender: "Female", color: "#FFFFFF", hairColor: "#000000",
        }).returning();
      for (const removed of previous.filter(url => !selected.includes(url))) {
        await tx.update(profilePhotos).set({ unusedSince: new Date() }).where(and(
          eq(profilePhotos.accountId, accountId),
          sql`'/api/photos/' || ${profilePhotos.id}::text = ${removed}`,
        ));
      }
      for (const kept of selected) {
        await tx.update(profilePhotos).set({ unusedSince: null }).where(and(
          eq(profilePhotos.accountId, accountId),
          sql`'/api/photos/' || ${profilePhotos.id}::text = ${kept}`,
        ));
      }
      return { profile: publicProfile(row!), previousPhotoUrls: previous };
    });
    const profile = saved.profile;
    const currentPhotoUrls = new Set(profilePhotoUrls(profile));
    const removedUrls = new Set(saved.previousPhotoUrls.filter(url => !currentPhotoUrls.has(url)));
    for (const url of removedUrls) {
      try { await deleteReplacedProfilePhoto(accountId, url); }
      catch (error) { console.error('Could not immediately delete replaced profile photo', error); }
    }
    roomStore.updateAccountIdentity(accountId, profile.displayName ?? profile.username, profile.identity, null);
    const photos = await visibleProfilePhotos(accountId, accountId, { photoUrl: profile.photoUrl ?? null, photoUrls: profile.photoUrls });
    return { ...profile, ...photos, photoUrls: photos.photoUrl ? [photos.photoUrl] : [],
      photoReviews: photos.photoReviews?.filter(photo => photo.photoUrl === photos.photoUrl) ?? [] };
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string });
    if (cause.code === "23505" || cause.cause?.code === "23505") {
      throw new RoomError(409, "That dedicated name is already taken");
    }
    throw error;
  }
}