import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { eventVisibility, rawEvents } from './raw-events.js';
import { teams } from './teams.js';
import { users } from './users.js';

// Phase 10 — Meeting bots. A user pastes a Google Meet / Microsoft Teams /
// Zoom URL; a silent bot joins via the configured provider (Recall.ai by
// default) and streams transcript chunks back via two webhooks (status +
// transcript). Each finalised chunk becomes a `meeting_transcript_chunks`
// row (embedded via source_kind='meeting_chunk' for utterance-granular
// search). When the meeting ends, the finalize worker creates ONE
// consolidated `raw_events` row (source='meeting') with the full transcript
// as contentText and the LLM summary in sourceMetadata.summary, then
// backfills rawEventId on all chunks for search attribution.
//
// Why both tables?
//   - raw_events: one row per meeting — drives timeline, extract worker,
//     embeddings, visibility. The meeting appears as a single event.
//   - meeting_transcript_chunks: structured speaker / start_ms / end_ms /
//     ordering for the meeting detail UI and utterance-level search.

export const meetingStatus = pgEnum('meeting_status', [
  'pending',
  'joining',
  'active',
  'processing',
  'completed',
  'failed',
]);

export const meetingPlatform = pgEnum('meeting_platform', ['meet', 'teams', 'zoom']);

export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Provider tag (e.g. 'recall'). Lets us swap to Attendee.dev / Meeting
    // BaaS / native APIs later without enum churn.
    provider: text('provider').notNull().default('recall'),
    // Provider-issued bot id, set after joinMeeting() returns. Indexed so
    // the unsigned transcript webhook can look up the meeting in O(1).
    // Nullable until the provider responds with the id.
    providerBotId: text('provider_bot_id'),
    platform: meetingPlatform('platform').notNull(),
    meetingUrl: text('meeting_url').notNull(),
    title: text('title'),
    status: meetingStatus('status').notNull().default('pending'),
    // Visibility for the meeting itself + the visibility copied onto each
    // raw_event generated from its transcript. Reuses `event_visibility` so
    // the same predicate gates both.
    defaultVisibility: eventVisibility('default_visibility').notNull().default('team'),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    // jsonb array of {name, email?, joined_at?}. Speaker labels reported by
    // the provider are appended here as they arrive.
    participants: jsonb('participants').notNull().default([]),
    // Free-form bag for provider-specific state: summary, consent_given_at,
    // silent: true, last status_change, etc.
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('meetings_team_created_idx').on(table.teamId, table.createdAt),
    index('meetings_team_status_idx').on(table.teamId, table.status),
    // One provider can never reuse a bot id across teams (it's a Recall
    // UUID); we still scope uniqueness per team to keep blast radius small
    // if a provider ever changes id semantics. Partial: NULL bot ids are
    // common during the pre-join window.
    uniqueIndex('meetings_team_bot_unq')
      .on(table.teamId, table.providerBotId)
      .where(sql`${table.providerBotId} IS NOT NULL`),
  ],
);

export const meetingTranscriptChunks = pgTable(
  'meeting_transcript_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    // Denormalised so the visibility / team filter doesn't have to join
    // through meetings on every read.
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    speaker: text('speaker'),
    text: text('text').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    // Back-link to the consolidated meeting raw_event. Finalize backfills
    // existing chunks; chunks arriving after finalize attach during insert.
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    // Provider's own per-utterance id when present. Drives idempotent
    // webhook replay via the partial unique index below.
    providerChunkId: text('provider_chunk_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('meeting_chunks_meeting_start_idx').on(table.meetingId, table.startMs),
    index('meeting_chunks_team_idx').on(table.teamId),
    uniqueIndex('meeting_chunks_provider_id_unq')
      .on(table.meetingId, table.providerChunkId)
      .where(sql`${table.providerChunkId} IS NOT NULL`),
  ],
);

// Per-meeting minutes used for cost guardrails. Aggregated per
// (teamId, calendar month) by the scheduleMeetingBot action.
export const meetingUsage = pgTable(
  'meeting_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    minutes: integer('minutes').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('meeting_usage_team_recorded_idx').on(table.teamId, table.recordedAt),
    // One usage row per finalised meeting (finalize is idempotent — we
    // ON CONFLICT DO NOTHING).
    uniqueIndex('meeting_usage_meeting_unq').on(table.meetingId),
  ],
);

// Per-team meeting bot settings — minute cap and admin override. Lives on
// a sidecar table so the existing `teams` row stays small and Phase-10-only
// columns don't churn the core schema.
export const teamMeetingSettings = pgTable('team_meeting_settings', {
  teamId: uuid('team_id')
    .primaryKey()
    .references(() => teams.id, { onDelete: 'cascade' }),
  // Per-calendar-month minute cap. 0 = disabled (no bots), null = unlimited.
  meetingMinutesCap: integer('meeting_minutes_cap').default(600),
  meetingMinutesAdminOverride: boolean('meeting_minutes_admin_override').notNull().default(false),
  // Default true — host (or team admin) must explicitly tick the consent
  // box in the composer before the bot joins. The audit raw_event captures
  // the timestamp the consent was given.
  requireHostConsent: boolean('require_host_consent').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
