import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Guest access carries no team membership or pending full-member seat.
export const guestInvitations = pgTable(
  'guest_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('guest_invitations_team_id_unique').on(table.teamId, table.id),
    unique('guest_invitations_team_email_unique').on(table.teamId, table.email),
    index('guest_invitations_recipient_idx').on(table.acceptedByUserId, table.teamId),
    check('guest_invitations_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'guest_invitations_normalized_email_check',
      sql`${table.email} = lower(trim(${table.email}))`,
    ),
  ],
);

export const guestSourceGrants = pgTable(
  'guest_source_grants',
  {
    teamId: uuid('team_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    rawEventId: uuid('raw_event_id').notNull(),
    revision: uuid('revision').defaultRandom().notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.invitationId, table.rawEventId] }),
    foreignKey({
      name: 'guest_source_grants_invitation_fk',
      columns: [table.teamId, table.invitationId],
      foreignColumns: [guestInvitations.teamId, guestInvitations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guest_source_grants_event_fk',
      columns: [table.teamId, table.rawEventId],
      foreignColumns: [rawEvents.teamId, rawEvents.id],
    }).onDelete('cascade'),
    index('guest_source_grants_event_idx').on(table.teamId, table.rawEventId),
  ],
);

export const guestRecordShares = pgTable(
  'guest_record_shares',
  {
    teamId: uuid('team_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    recordId: uuid('record_id').notNull(),
    live: boolean('live').notNull().default(false),
    title: text('title'),
    body: text('body'),
    revision: uuid('revision').defaultRandom().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.invitationId, table.recordId] }),
    foreignKey({
      name: 'guest_record_shares_invitation_fk',
      columns: [table.teamId, table.invitationId],
      foreignColumns: [guestInvitations.teamId, guestInvitations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guest_record_shares_record_fk',
      columns: [table.teamId, table.recordId],
      foreignColumns: [entities.teamId, entities.id],
    }).onDelete('cascade'),
    index('guest_record_shares_record_idx').on(table.teamId, table.recordId),
    check(
      'guest_record_shares_content_check',
      sql`(
      (${table.live} AND ${table.title} IS NULL AND ${table.body} IS NULL)
      OR (NOT ${table.live} AND ${table.title} IS NOT NULL AND ${table.body} IS NOT NULL
        AND char_length(${table.title}) BETWEEN 1 AND 200 AND char_length(${table.body}) BETWEEN 1 AND 8000)
    )`,
    ),
  ],
);
