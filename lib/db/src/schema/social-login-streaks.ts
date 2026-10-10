import { pgTable, text, date, integer } from 'drizzle-orm/pg-core';
import { accountProfiles } from './account-profiles';

export const socialLoginStreaks = pgTable('social_login_streaks', {
  accountId: text('account_id').primaryKey().references(() => accountProfiles.accountId, { onDelete: 'cascade' }),
  lastLoginDay: date('last_login_day', { mode: 'string' }).notNull(),
  consecutiveDays: integer('consecutive_days').notNull(),
});
