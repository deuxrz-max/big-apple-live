import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { accountProfiles } from './account-profiles';
export const socialMessages = pgTable('social_messages', {id: uuid('id').primaryKey(), senderId: text('sender_id').notNull().references(()=>accountProfiles.accountId,{onDelete:'cascade'}), recipientId: text('recipient_id').notNull().references(()=>accountProfiles.accountId,{onDelete:'cascade'}), body: text('body').notNull(), senderHidden: boolean('sender_hidden').notNull().default(false), recipientHidden: boolean('recipient_hidden').notNull().default(false), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), readAt: timestamp('read_at',{withTimezone:true})}, (t)=>[index('social_message_sender').on(t.senderId,t.createdAt),index('social_message_recipient').on(t.recipientId,t.createdAt),check('social_message_not_self',sql`${t.senderId} <> ${t.recipientId}`),check('social_message_length',sql`char_length(${t.body}) BETWEEN 1 AND 1000`)]);
export const insertSocialMessagesSchema = createInsertSchema(socialMessages);
export type SocialMessagesRow = typeof socialMessages.$inferSelect;
