import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';

export const websites = pgTable(
  'websites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    hostname: text('hostname').notNull(),
    subject: text('subject').$type<'own_team' | 'other_company'>().notNull(),
    createdBy: uuid('created_by').notNull(),
    scheduleBy: uuid('schedule_by'),
    schedulePrincipal: jsonb('schedule_principal').$type<{
      authType: 'api_key' | 'oauth';
      teamId: string;
      userId: string;
      keyId: string;
      clientId: string;
      scopes: string[];
    }>(),
    schedule: jsonb('schedule')
      .$type<{
        frequency: 'manual' | 'daily' | 'weekly';
        time: string;
        weekday: number;
        timezone: string;
      }>()
      .notNull()
      .default({ frequency: 'manual', time: '09:00', weekday: 1, timezone: 'UTC' }),
    paused: boolean('paused').notNull().default(false),
    blockedReason: text('blocked_reason'),
    nextScanAt: timestamp('next_scan_at', { withTimezone: true }),
    lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('websites_active_url')
      .on(t.teamId, t.url)
      .where(sql`${t.archivedAt} IS NULL`),
    index('websites_due').on(t.nextScanAt),
  ],
);

export const websiteRuns = pgTable(
  'website_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => websites.id),
    requestedBy: uuid('requested_by').notNull(),
    principal: jsonb('principal').$type<{
      authType: 'api_key' | 'oauth';
      teamId: string;
      userId: string;
      keyId: string;
      clientId: string;
      scopes: string[];
    }>(),
    trigger: text('trigger')
      .$type<'manual' | 'scheduled' | 'onboarding' | 'bot' | 'mcp'>()
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status')
      .$type<
        | 'queued'
        | 'crawling'
        | 'processing'
        | 'completed'
        | 'partial'
        | 'failed'
        | 'cancelled'
        | 'blocked'
      >()
      .notNull()
      .default('queued'),
    billingPolicy: text('billing_policy').notNull().default('website-v1'),
    unitsPerPage: integer('units_per_page').notNull().default(20),
    pageCount: integer('page_count').notNull().default(0),
    changedCount: integer('changed_count').notNull().default(0),
    sourceUnits: integer('source_units').notNull().default(0),
    providerCredits: integer('provider_credits'),
    estimatedProviderCostEur: doublePrecision('estimated_provider_cost_eur'),
    failureReason: text('failure_reason'),
    providerFinishedAt: timestamp('provider_finished_at', { withTimezone: true }),
    providerStartedAt: timestamp('provider_started_at', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    handoffAt: timestamp('handoff_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('website_runs_idempotency').on(t.teamId, t.idempotencyKey),
    uniqueIndex('website_runs_one_active_team')
      .on(t.teamId)
      .where(sql`${t.status} IN ('queued', 'crawling', 'processing')`),
    index('website_runs_source').on(t.teamId, t.websiteId, t.createdAt),
  ],
);

export const websitePages = pgTable(
  'website_pages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    websiteId: uuid('website_id')
      .notNull()
      .references(() => websites.id),
    url: text('url').notNull(),
    documentId: uuid('document_id'),
    currentEventId: uuid('current_event_id'),
    currentVersionId: uuid('current_version_id'),
    contentHash: text('content_hash'),
  },
  (t) => [uniqueIndex('website_pages_url').on(t.teamId, t.websiteId, t.url)],
);

export const websiteNotifications = pgTable('website_notifications', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => websiteRuns.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
