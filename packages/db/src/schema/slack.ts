import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { eventVisibility } from './raw-events.js';
import { teams } from './teams.js';
import { users } from './users.js';

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const slackWorkspaces = pgTable(
  'slack_workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slackTeamId: text('slack_team_id').notNull(),
    slackEnterpriseId: text('slack_enterprise_id'),
    name: text('name'),
    domain: text('domain'),
    botUserId: text('bot_user_id'),
    appId: text('app_id'),
    scopes: text('scopes').array(),
    tokenCiphertext: bytea('token_ciphertext').notNull(),
    tokenIv: bytea('token_iv').notNull(),
    tokenTag: bytea('token_tag').notNull(),
    installedByUserId: uuid('installed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('slack_workspaces_team_unq').on(table.slackTeamId),
    index('slack_workspaces_enterprise_idx').on(table.slackEnterpriseId),
  ],
);

export const slackWorkspaceTeams = pgTable(
  'slack_workspace_teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => slackWorkspaces.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    installedByUserId: uuid('installed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('slack_workspace_teams_unq').on(table.workspaceId, table.teamId),
    index('slack_workspace_teams_team_idx').on(table.teamId),
  ],
);

export const slackUsers = pgTable(
  'slack_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => slackWorkspaces.id, { onDelete: 'cascade' }),
    slackUserId: text('slack_user_id').notNull(),
    name: text('name'),
    realName: text('real_name'),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('slack_users_workspace_user_unq').on(table.workspaceId, table.slackUserId),
    index('slack_users_email_idx').on(table.email),
  ],
);

export const slackUserTeams = pgTable(
  'slack_user_teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slackUserId: uuid('slack_user_id')
      .notNull()
      .references(() => slackUsers.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    linkedByUserId: uuid('linked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('slack_user_teams_user_team_unq').on(table.slackUserId, table.teamId),
    uniqueIndex('slack_user_teams_active_unq')
      .on(table.slackUserId)
      .where(sql`${table.isActive}`),
    index('slack_user_teams_team_idx').on(table.teamId),
    index('slack_user_teams_user_idx').on(table.userId),
  ],
);

export const slackConversationBindings = pgTable(
  'slack_conversation_bindings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => slackWorkspaces.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    slackConversationId: text('slack_conversation_id').notNull(),
    conversationType: text('conversation_type').notNull(),
    title: text('title'),
    boundByUserId: uuid('bound_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    visibilityDefault: eventVisibility('visibility_default').notNull().default('team'),
    enabled: boolean('enabled').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('slack_conversation_bindings_workspace_conversation_unq')
      .on(table.workspaceId, table.slackConversationId)
      .where(sql`${table.enabled}`),
    index('slack_conversation_bindings_team_idx').on(table.teamId),
  ],
);
