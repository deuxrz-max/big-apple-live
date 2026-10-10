import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { accountProfiles } from './account-profiles';
export const socialInventory = pgTable('social_inventory', {accountId: text('account_id').notNull().references(()=>accountProfiles.accountId,{onDelete:'cascade'}), itemId: text('item_id').notNull(), purchasedAt: timestamp('purchased_at',{withTimezone:true}).notNull().defaultNow(), expiresAt: timestamp('expires_at',{withTimezone:true})}, (t)=>[primaryKey({columns:[t.accountId,t.itemId]})]);
export const insertSocialInventorySchema = createInsertSchema(socialInventory);
export type SocialInventoryRow = typeof socialInventory.$inferSelect;
