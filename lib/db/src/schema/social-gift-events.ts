import { pgTable, uuid, text, integer, timestamp, index, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { accountProfiles } from './account-profiles';

/** Immutable gift receipts also retain the house's allocation, without a fake user wallet. */
export const socialGiftEvents = pgTable('social_gift_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  historyId: text('history_id').notNull(),
  senderId: text('sender_id').references(() => accountProfiles.accountId, { onDelete: 'set null' }),
  recipientId: text('recipient_id').references(() => accountProfiles.accountId, { onDelete: 'set null' }),
  senderUsername: text('sender_username').notNull(),
  recipientUsername: text('recipient_username').notNull(),
  senderName: text('sender_name').notNull(),
  recipientName: text('recipient_name').notNull(),
  giftId: text('gift_id').notNull(),
  cost: integer('cost').notNull(),
  recipientCredits: integer('recipient_credits').notNull(),
  houseCredits: integer('house_credits').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('social_gift_events_room_time').on(t.historyId, t.createdAt),
  check('social_gift_split', sql`${t.cost} > 0 AND ${t.recipientCredits} >= 0 AND ${t.houseCredits} >= 0 AND ${t.cost} = ${t.recipientCredits} + ${t.houseCredits}`),
]);

export const socialGiftBag = pgTable('social_gift_bag', {
  accountId: text('account_id').notNull().references(() => accountProfiles.accountId, { onDelete: 'cascade' }),
  giftId: text('gift_id').notNull(),
  quantity: integer('quantity').notNull().default(0),
}, t => [primaryKey({ columns: [t.accountId, t.giftId] }), check('social_gift_quantity', sql`${t.quantity} > 0`)]);
