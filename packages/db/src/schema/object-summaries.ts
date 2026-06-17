import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { teams } from '#src/schema/teams.js';

export const objectSummaryStatus = pgEnum('object_summary_status', [
  'pending',
  'ready',
  'stale',
  'failed',
]);

export const objectSummaryRunStatus = pgEnum('object_summary_run_status', [
  'pending',
  'ready',
  'skipped',
  'failed',
]);

export const objectSummaries = pgTable(
  'object_summaries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    status: objectSummaryStatus('status').notNull().default('pending'),
    summary: jsonb('summary').notNull().default({}),
    plainText: text('plain_text').notNull().default(''),
    sourceRefs: jsonb('source_refs').notNull().default([]),
    sourceCounts: jsonb('source_counts').notNull().default({}),
    inputFingerprint: text('input_fingerprint'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('object_summaries_team_entity_unq').on(table.teamId, table.entityId),
    index('object_summaries_team_status_idx').on(table.teamId, table.status),
  ],
);

export const objectSummaryRuns = pgTable(
  'object_summary_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    status: objectSummaryRunStatus('status').notNull().default('pending'),
    trigger: text('trigger').notNull().default('manual'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    inputFingerprint: text('input_fingerprint'),
    sourceCounts: jsonb('source_counts').notNull().default({}),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('object_summary_runs_team_entity_started_idx').on(
      table.teamId,
      table.entityId,
      table.startedAt,
    ),
    index('object_summary_runs_team_status_idx').on(table.teamId, table.status),
  ],
);
