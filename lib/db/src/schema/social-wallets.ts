import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { accountProfiles } from './account-profiles';
export const socialWallets = pgTable('social_wallets', {accountId: text('account_id').primaryKey().references(() => accountProfiles.accountId,{onDelete:'cascade'}), balance: integer('balance').notNull().default(0), earned: integer('earned').notNull().default(0), received: integer('received').notNull().default(0), sent: integer('sent').notNull().default(0), lastClaimDay: text('last_claim_day')}, (t)=>[check('social_nonnegative_balance',sql`${t.balance} >= 0 AND ${t.earned} >= 0 AND ${t.received} >= 0 AND ${t.sent} >= 0`)]);
export const insertSocialWalletsSchema = createInsertSchema(socialWallets);
export type SocialWalletsRow = typeof socialWallets.$inferSelect;
