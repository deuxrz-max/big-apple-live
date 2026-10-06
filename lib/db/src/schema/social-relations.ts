import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { accountProfiles } from './account-profiles';
export const socialRelations = pgTable('social_relations', {ownerId: text('owner_id').notNull().references(()=>accountProfiles.accountId,{onDelete:'cascade'}), targetId: text('target_id').notNull().references(()=>accountProfiles.accountId,{onDelete:'cascade'}), kind: text('kind',{enum:['favorite','block']}).notNull()}, (t)=>[primaryKey({columns:[t.ownerId,t.targetId,t.kind]}),check('social_no_self_relation',sql`${t.ownerId} <> ${t.targetId}`),index('social_relation_target').on(t.targetId)]);
export const insertSocialRelationsSchema = createInsertSchema(socialRelations);
export type SocialRelationsRow = typeof socialRelations.$inferSelect;
