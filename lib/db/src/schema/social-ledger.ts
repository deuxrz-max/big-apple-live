import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { accountProfiles } from './account-profiles';
export const socialLedger = pgTable('social_ledger', {id: uuid('id').primaryKey().defaultRandom(), accountId: text('account_id').notNull().references(()=>accountProfiles.accountId,{onDelete:'cascade'}), delta: integer('delta').notNull(), kind: text('kind',{enum:['reward','gift_sent','gift_received','purchase','credit_purchase']}).notNull(), description: text('description').notNull(), peer: text('peer'), requestKey: uuid('request_key'), refKey: text('ref_key'), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow()}, (t)=>[uniqueIndex('social_ledger_request').on(t.accountId,t.requestKey),index('social_ledger_owner').on(t.accountId,t.createdAt),check('social_nonzero_delta',sql`${t.delta} <> 0`)]);
export const insertSocialLedgerSchema = createInsertSchema(socialLedger);
export type SocialLedgerRow = typeof socialLedger.$inferSelect;
