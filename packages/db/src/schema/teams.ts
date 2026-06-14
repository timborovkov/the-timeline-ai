import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '#src/schema/users.js';

export const teamRole = pgEnum('team_role', ['owner', 'admin', 'member']);
export const teamInviteSendStatus = pgEnum('team_invite_send_status', [
  'pending',
  'sent',
  'failed',
]);

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // Phase 7: per-team inbound email address. Format is `<slug>@<INBOUND_EMAIL_DOMAIN>`,
  // populated at team creation. Nullable because legacy rows (created before
  // Phase 7) backfill via migration but new teams should never be NULL — the
  // address is the team's only inbound surface for email and absence is a bug,
  // not a state. Unique across teams so cross-team routing in the inbound
  // dispatcher cannot ambiguously match.
  inboundEmail: text('inbound_email').unique(),
  inboundSenderWhitelistEnabled: boolean('inbound_sender_whitelist_enabled')
    .notNull()
    .default(false),
  inboundSenderWhitelist: jsonb('inbound_sender_whitelist').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedByUserId: uuid('removed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index('team_members_team_active_idx').on(table.teamId, table.removedAt),
    index('team_members_user_active_idx').on(table.userId, table.removedAt),
  ],
);

export const teamInvites = pgTable(
  'team_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: teamRole('role').notNull().default('member'),
    token: text('token').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    sendStatus: teamInviteSendStatus('send_status').notNull().default('pending'),
    sendError: text('send_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('team_invites_team_created_idx').on(table.teamId, table.createdAt),
    index('team_invites_team_email_idx').on(table.teamId, table.email),
  ],
);
