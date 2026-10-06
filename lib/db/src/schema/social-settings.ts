import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { accountProfiles } from './account-profiles';
export const socialSettings = pgTable('social_settings', {accountId: text('account_id').primaryKey().references(() => accountProfiles.accountId, {onDelete:'cascade'}), bio: text('bio').notNull().default(''), country: text('country'), interests: jsonb('interests').$type<string[]>().notNull().default([]), discoverable: boolean('discoverable').notNull().default(false), badgeId: text('badge_id'), updatedAt: timestamp('updated_at', {withTimezone:true}).notNull().defaultNow()});
export const insertSocialSettingsSchema = createInsertSchema(socialSettings);
export type SocialSettingsRow = typeof socialSettings.$inferSelect;
