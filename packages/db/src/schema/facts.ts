import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';

export const facts = pgTable(
  'facts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Denormalized for query speed (entity-page joins go through facts) and
    // to enforce team isolation at the row level without joining raw_events.
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id')
      .notNull()
      .references(() => rawEvents.id, { onDelete: 'cascade' }),
    statement: text('statement').notNull(),
    confidence: real('confidence').notNull(),
    // Model + code revision used to extract this fact. Used as the
    // re-extraction skip key and surfaced in audits.
    modelVersion: text('model_version').notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('facts_team_idx').on(table.teamId),
    index('facts_raw_event_idx').on(table.rawEventId),
    // Idempotency for re-runs: a given raw_event + model_version + statement
    // cannot be inserted twice.
    uniqueIndex('facts_raw_event_model_statement_unq').on(
      table.rawEventId,
      table.modelVersion,
      sql`md5(${table.statement})`,
    ),
    check('facts_confidence_range', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  ],
);
