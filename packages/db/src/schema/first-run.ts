import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { documents } from '#src/schema/documents.js';
import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const firstRunPhase = pgEnum('first_run_phase', [
  'welcome',
  'choose',
  'processing',
  'record',
  'ask',
  'approve',
  'live',
  'complete',
  'skipped',
  'failed',
]);

export const firstRunPath = pgEnum('first_run_path', ['website', 'document', 'email', 'skip']);

export const firstRunScanFailureReason = pgEnum('first_run_scan_failure_reason', [
  'no_readable_text',
  'robots',
  'unreachable',
  'not_enabled',
  'rate_limited',
]);

export const teamFirstRun = pgTable('team_first_run', {
  teamId: uuid('team_id')
    .primaryKey()
    .references(() => teams.id, { onDelete: 'cascade' }),
  startedByUserId: uuid('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  phase: firstRunPhase('phase').notNull().default('welcome'),
  starterPath: firstRunPath('starter_path'),
  starterSelectedAt: timestamp('starter_selected_at', { withTimezone: true }),
  captureDocumentId: uuid('capture_document_id').references(() => documents.id, {
    onDelete: 'set null',
  }),
  captureEventId: uuid('capture_event_id').references(() => rawEvents.id, { onDelete: 'set null' }),
  websiteUrl: text('website_url'),
  websiteHost: text('website_host'),
  scanFailureReason: firstRunScanFailureReason('scan_failure_reason'),
  guideHiddenAt: timestamp('guide_hidden_at', { withTimezone: true }),
  firstCaptureLandedAt: timestamp('first_capture_landed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
