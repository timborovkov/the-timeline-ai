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

import type { AgentReportingPreference } from '#src/schema/agent-reporting.js';

export const teamRole = pgEnum('team_role', ['owner', 'admin', 'member']);

/** How the team mostly works — orders suggestions and the recommended go-live channel. Never team size. */
export const teamWorkStyle = pgEnum('team_work_style', [
  'email',
  'chat',
  'dealflow',
  'delivery',
  'other',
]);

/** Closed membership windows preserved when a removed member is re-accepted. */
export interface TeamMemberPriorInterval {
  startedAt: string;
  endedAt: string;
}
export const teamInviteSendStatus = pgEnum('team_invite_send_status', [
  'pending',
  'sent',
  'failed',
]);

export interface TeamLifecycleWork {
  disabledDateUnknown?: boolean;
  pendingCheckoutIds?: string[];
  deletionActorUserId?: string;
  billingPending?: boolean;
  botsPending?: boolean;
  notificationPending?: boolean;
  requestId?: string;
  stage?: 'inventory' | 'stop' | 'purge' | 'verify' | 'complete';
  error?: string;
  attempts?: number;
  retryAt?: string;
  connectionIds?: string[];
  slackWorkspaceIds?: string[];
  webhookDeliveryIds?: string[];
  verifiedAt?: string;
  externalFollowup?: string;
  followups?: {
    category: 'backups' | 'processors' | 'retained_records';
    status: 'pending' | 'retained' | 'complete';
    reference: string;
    expiresAt?: string;
  }[];
}

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentReporting: jsonb('agent_reporting')
    .$type<AgentReportingPreference>()
    .notNull()
    .default({ mode: 'on_request', scope: '', revision: '0' }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  suspensionPreviousState: text('suspension_previous_state'),
  disabledPeriods: jsonb('disabled_periods')
    .$type<{ start: string; end?: string }[]>()
    .notNull()
    .default([]),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  disabledByUserId: uuid('disabled_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  disabledReason: text('disabled_reason'),
  deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
  deletionRequestedByUserId: uuid('deletion_requested_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  deletionStartedAt: timestamp('deletion_started_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  lifecycleWork: jsonb('lifecycle_work').$type<TeamLifecycleWork>().notNull().default({}),
  // Phase 7: per-team inbound email address. Format is `<slug>@<INBOUND_EMAIL_DOMAIN>`,
  // populated at team creation. Nullable because legacy rows (created before
  // Phase 7) backfill via migration but new teams should never be NULL — the
  // address is the team's only inbound surface for email and absence is a bug,
  // not a state. Unique across teams so cross-team routing in the inbound
  // dispatcher cannot ambiguously match.
  inboundEmail: text('inbound_email').unique(),
  workStyle: teamWorkStyle('work_style'),
  inboundSenderWhitelistEnabled: boolean('inbound_sender_whitelist_enabled')
    .notNull()
    .default(true),
  // Additional addresses; active member account emails are allowed dynamically.
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
    authorizationEpoch: uuid('authorization_epoch').defaultRandom().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    priorIntervals: jsonb('prior_intervals')
      .$type<TeamMemberPriorInterval[]>()
      .notNull()
      .default([]),
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

export const retiredTeamRoutes = pgTable('retired_team_routes', {
  routeHash: text('route_hash').primaryKey(),
});
