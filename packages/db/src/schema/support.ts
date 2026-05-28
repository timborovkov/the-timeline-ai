import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const supportRequestType = pgEnum('support_request_type', [
  'technical_support',
  'sales',
  'billing',
  'security',
  'other',
]);

export const supportRequests = pgTable(
  'support_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestType: supportRequestType('request_type').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    message: text('message').notNull(),
    currentPage: text('current_page'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    context: jsonb('context').notNull().default({}),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    emailError: text('email_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('support_requests_created_idx').on(table.createdAt),
    index('support_requests_team_created_idx').on(table.teamId, table.createdAt),
    index('support_requests_user_created_idx').on(table.userId, table.createdAt),
  ],
);
