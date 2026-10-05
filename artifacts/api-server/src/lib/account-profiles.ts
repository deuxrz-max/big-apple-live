import { db, accountProfiles, type AccountProfileRow } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { AccountProfile, ProfileInput } from "@workspace/api-zod";
import { RoomError, roomStore } from "./room-store";
import { validateEmojiId } from "./emoji-library";
import { isPortraitId, portraitHair } from "@workspace/beam-identity";

export function publicProfile(row: AccountProfileRow): AccountProfile {
  return {
    username: row.username,
    identity: {
      emojiId: row.emojiId, gender: row.gender, color: row.color, hairColor: row.hairColor,
      ...(row.portraitId ? { portraitId: row.portraitId } : {}),
      ...(row.currentMood ? { currentMood: row.currentMood as AccountProfile["identity"]["currentMood"] } : {}),
    },
    updatedAt: row.updatedAt,
  };
}
export async function getProfile(accountId: string): Promise<AccountProfile | null> {
  const [row] = await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
  return row ? publicProfile(row) : null;
}
export async function ensureGuestNameAvailable(name: string): Promise<void> {
  const [row] = await db.select({ name: accountProfiles.username }).from(accountProfiles)
    .where(eq(accountProfiles.nameKey, name.trim().toLowerCase())).limit(1);
  if (row) throw new RoomError(409, "This name is reserved by an account; sign in to use your dedicated name");
}
export async function saveProfile(accountId: string, input: ProfileInput): Promise<AccountProfile> {
  validateEmojiId(input.identity.emojiId);
  if (input.identity.portraitId != null) {
    if (!isPortraitId(input.identity.portraitId)
      || portraitHair(input.identity.portraitId) !== (input.identity.gender === "Male" ? "spiked" : "ponytails")) {
      throw new RoomError(400, "Choose supplied artwork matching your hairstyle");
    }
  }
  const nameKey = input.username.toLowerCase();
  try {
    const profile = await db.transaction(async (tx) => {
      // Serialize first-claim/edit for the same account. The unique name index
      // independently protects concurrent claims by different accounts.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`);
      const [existing] = await tx.select().from(accountProfiles).where(eq(accountProfiles.accountId, accountId));
      if (existing && existing.nameKey !== nameKey) throw new RoomError(409, "Your dedicated name is permanent");
      const selectedPortrait = input.identity.portraitId === undefined ? existing?.portraitId : input.identity.portraitId;
      if (selectedPortrait && isPortraitId(selectedPortrait)
        && portraitHair(selectedPortrait) !== (input.identity.gender === "Male" ? "spiked" : "ponytails")) {
        throw new RoomError(400, "Choose matching artwork when changing your hairstyle");
      }
      const values = {
        emojiId: input.identity.emojiId, gender: input.identity.gender,
        color: input.identity.color.toUpperCase(), hairColor: input.identity.hairColor.toUpperCase(),
        updatedAt: new Date(),
        // Old clients omit these fields; preserve their saved mood and artwork.
        ...(input.identity.portraitId !== undefined ? { portraitId: input.identity.portraitId } : {}),
        ...(input.identity.currentMood !== undefined ? { currentMood: input.identity.currentMood } : {}),
      };
      const [row] = existing
        ? await tx.update(accountProfiles).set(values).where(eq(accountProfiles.accountId, accountId)).returning()
        : await tx.insert(accountProfiles).values({ ...values, accountId, username: input.username, nameKey }).returning();
      return publicProfile(row!);
    });
    roomStore.updateAccountIdentity(accountId, profile.username, profile.identity);
    return profile;
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string });
    if (cause.code === "23505" || cause.cause?.code === "23505") {
      throw new RoomError(409, "That dedicated name is already taken");
    }
    throw error;
  }
}