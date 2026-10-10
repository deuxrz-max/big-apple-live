import { and, eq, sql } from "drizzle-orm";
import { db, accountProfiles } from "@workspace/db";
import { roomStore, RoomError } from "../room-store";
import { getPerson } from "./people";

/** Favoriting is the sole location-sharing permission; either-direction blocks override it. */
async function allowedFavorites(viewerId: string, username?: string) {
  return db.select().from(accountProfiles).where(and(
    username ? eq(accountProfiles.username, username) : undefined,
    process.env.NODE_ENV === "production" ? eq(accountProfiles.isTestAccount, false) : undefined,
    sql`EXISTS (SELECT 1 FROM social_relations f WHERE f.kind = 'favorite'
      AND f.owner_id = ${viewerId} AND f.target_id = ${accountProfiles.accountId})`,
    sql`NOT EXISTS (SELECT 1 FROM social_relations b WHERE b.kind = 'block' AND
      ((b.owner_id = ${viewerId} AND b.target_id = ${accountProfiles.accountId}) OR
       (b.owner_id = ${accountProfiles.accountId} AND b.target_id = ${viewerId})))`,
  )).orderBy(accountProfiles.nameKey);
}

export async function favoritesGallery(viewerId: string) {
  const profiles = await allowedFavorites(viewerId);
  const entries = await Promise.all(profiles.map(async profile => {
    try {
      return {
        person: await getPerson(viewerId, profile.username),
        room: roomStore.latestUniversityForAccount(profile.accountId),
      };
    } catch (error) {
      // A newly placed block during this read must not reveal the person or their location.
      if (error instanceof RoomError && [403, 404].includes(error.status)) return null;
      throw error;
    }
  }));
  return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export async function favoriteRoom(viewerId: string, username: string) {
  const [profile] = await allowedFavorites(viewerId, username);
  if (!profile) throw new RoomError(404, "This favorite is no longer available.");
  return { room: roomStore.latestUniversityForAccount(profile.accountId) };
}
