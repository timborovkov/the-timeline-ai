import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from './teams.js';
import { users } from './users.js';

export const eventSource = pgEnum('event_source', [
  'web',
  'telegram',
  'email',
  'system',
  'document',
  // Phase 10 — meeting bot transcripts (Google Meet / Teams / Zoom via
  // Recall.ai). Per-utterance raw_events are created by the transcript
  // webhook; the specific platform lives in source_metadata.platform.
  'meeting',
]);

export const eventVisibility = pgEnum('event_visibility', ['private', 'team', 'specific_users']);

export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: eventSource('source').notNull(),
    contentText: text('content_text'),
    contentAudioUrl: text('content_audio_url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    sourceMetadata: jsonb('source_metadata').notNull().default({}),
  },
  (table) => [
    index('raw_events_team_idx').on(table.teamId),
    index('raw_events_team_occurred_idx').on(table.teamId, table.occurredAt),
    index('raw_events_author_idx').on(table.authorUserId),
    // Idempotency: Telegram delivers the same update_id on retry when we
    // 5xx, time out, or crash before responding. The partial unique index
    // makes the second insert a no-op via ON CONFLICT DO NOTHING.
    uniqueIndex('raw_events_telegram_update_id_unq')
      .on(sql`((${table.sourceMetadata} ->> 'tg_update_id'))`)
      .where(sql`${table.source} = 'telegram' AND ${table.sourceMetadata} ? 'tg_update_id'`),
    // Phase 7: email idempotency. Postmark retries on 5xx (and silent timeouts);
    // a forged Message-ID also lets one team's payload collide with another's,
    // so the uniqueness is scoped per team — both teams can hold a row keyed on
    // the same Message-ID, and ON CONFLICT DO NOTHING dedups within a team.
    uniqueIndex('raw_events_email_message_id_unq')
      .on(table.teamId, sql`((${table.sourceMetadata} ->> 'message_id'))`)
      .where(sql`${table.source} = 'email' AND ${table.sourceMetadata} ? 'message_id'`),
    // Phase 10: meeting transcript chunks. Recall.ai retries the unsigned
    // transcript webhook on a 5xx, and the `meeting_transcript_chunks`
    // unique index already dedups in its own table — but the audit
    // raw_event row was previously vulnerable to a double-insert when a
    // retry hit before the prior insert committed. Same per-team scoping
    // as email so a forged provider id can't collide across teams.
    // No `source = 'meeting'` filter: the enum value is added in the same
    // drizzle transaction as this index (Postgres 55P04 — unsafe use of
    // new enum value), and a `source::text` cast is STABLE so rejected by
    // 42P17. The JSONB-key check is sufficient because only the meeting
    // ingest path sets `meeting_chunk_provider_id` (see
    // packages/shared/src/meetings/scope.ts).
    uniqueIndex('raw_events_meeting_chunk_id_unq')
      .on(table.teamId, sql`((${table.sourceMetadata} ->> 'meeting_chunk_provider_id'))`)
      .where(sql`${table.sourceMetadata} ? 'meeting_chunk_provider_id'`),
  ],
);
