import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const teamRole = pgEnum('team_role', ['owner', 'admin', 'member']);

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
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);

export const teamInvites = pgTable('team_invites', {
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
