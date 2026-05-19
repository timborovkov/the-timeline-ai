import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from './teams';
import { users } from './users';

export const telegramLinkScope = pgEnum('telegram_link_scope', ['personal', 'group']);

export const telegramUsers = pgTable(
  'telegram_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tgUserId: bigint('tg_user_id', { mode: 'number' }).notNull().unique(),
    username: text('username'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('telegram_users_user_idx').on(table.userId)],
);

export const telegramUserTeams = pgTable(
  'telegram_user_teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramUserId: uuid('telegram_user_id')
      .notNull()
      .references(() => telegramUsers.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('telegram_user_teams_user_team_unq').on(table.telegramUserId, table.teamId),
    uniqueIndex('telegram_user_teams_active_unq')
      .on(table.telegramUserId)
      .where(sql`${table.isActive}`),
    index('telegram_user_teams_team_idx').on(table.teamId),
  ],
);

export const telegramChatBindings = pgTable(
  'telegram_chat_bindings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull().unique(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    boundByUserId: uuid('bound_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('telegram_chat_bindings_team_idx').on(table.teamId)],
);

export const telegramLinkTokens = pgTable(
  'telegram_link_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    token: text('token').notNull().unique(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    scope: telegramLinkScope('scope').notNull(),
    issuedByUserId: uuid('issued_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedByTgUserId: bigint('consumed_by_tg_user_id', { mode: 'number' }),
    consumedChatId: bigint('consumed_chat_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('telegram_link_tokens_team_expires_idx').on(table.teamId, table.expiresAt)],
);
