import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { accountProfiles } from './account-profiles';

export const socialProfileCosmetics = pgTable('social_profile_cosmetics', {
  accountId: text('account_id').notNull().references(() => accountProfiles.accountId, { onDelete: 'cascade' }),
  cosmeticId: text('cosmetic_id').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.accountId, table.cosmeticId] })]);

export type SocialProfileCosmetic = typeof socialProfileCosmetics.$inferSelect;
