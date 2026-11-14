import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { accountProfiles } from './account-profiles';
export const socialSettings = pgTable('social_settings', {
  accountId: text('account_id').primaryKey().references(() => accountProfiles.accountId, {onDelete:'cascade'}),
  bio: text('bio').notNull().default(''), country: text('country'),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  race: text('race', { enum: ['Human'] }).notNull().default('Human'),
  job: text('job', { enum: ['Apprentice', 'Squire', 'Initiate', 'Trapper', 'Novice', 'Acolyte', 'Scoundrel', 'Tinker'] }),
   equippedFrameId: text('equipped_frame_id').notNull().default('grey-starter'),
   equippedNameColorId: text('equipped_name_color_id').notNull().default('white'),
   equippedSpecialNameId: text('equipped_special_name_id'),
  discoverable: boolean('discoverable').notNull().default(false), badgeId: text('badge_id'),
  equippedBadgeId: text('equipped_badge_id'),
  badgeEquipPreferenceSet: boolean('badge_equip_preference_set').notNull().default(false),
  externalPlatform: text('external_platform'), externalHandle: text('external_handle'),
  entranceEffectsEnabled: boolean('entrance_effects_enabled').notNull().default(true),
  ownerTestBadgeTier: integer('owner_test_badge_tier').notNull().default(5),
  ownerTierEntranceEffects: jsonb('owner_tier_entrance_effects').$type<Record<string, boolean>>().notNull().default(sql`'{}'::jsonb`),
  ownerLionEntranceEnabled: boolean('owner_lion_entrance_enabled').notNull().default(true),
  equippedEntranceEffectId: text('equipped_entrance_effect_id'),
  updatedAt: timestamp('updated_at', {withTimezone:true}).notNull().defaultNow(),
});
export const insertSocialSettingsSchema = createInsertSchema(socialSettings);
export type SocialSettingsRow = typeof socialSettings.$inferSelect;
