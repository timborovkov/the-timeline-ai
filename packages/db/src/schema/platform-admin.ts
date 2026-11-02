import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const platformAdminAudit = pgTable(
  'platform_admin_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    effectiveUserId: uuid('effective_user_id').references(() => users.id),
    teamId: uuid('team_id').references(() => teams.id),
    sessionId: uuid('session_id'),
    action: text('action').notNull(),
    targetId: uuid('target_id'),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('platform_admin_audit_created_idx').on(t.createdAt),
    index('platform_admin_audit_actor_idx').on(t.actorUserId),
  ],
);

export const platformImpersonationSessions = pgTable(
  'platform_impersonation_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    effectiveUserId: uuid('effective_user_id')
      .notNull()
      .references(() => users.id),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    authorizationEpoch: uuid('authorization_epoch').notNull(),
    purpose: text('purpose').notNull(),
    reference: text('reference').notNull(),
    authorization: text('authorization').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('platform_impersonation_actor_idx').on(t.actorUserId)],
);
