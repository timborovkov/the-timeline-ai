import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';

// Presentation cache only. The canonical evidence remains raw_events and the
// deterministic moment projection remains rebuildable from source events.
export const timelineMomentPresentations = pgTable(
  'timeline_moment_presentations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    momentKey: text('moment_key').notNull(),
    cacheFingerprint: text('cache_fingerprint').notNull(),
    visibilityScopeHash: text('visibility_scope_hash').notNull(),
    visibleSourceEventIdsHash: text('visible_source_event_ids_hash').notNull(),
    visibleSourceContentHash: text('visible_source_content_hash').notNull(),
    impactHydrationHash: text('impact_hydration_hash').notNull(),
    artifactClusterHash: text('artifact_cluster_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    suggestion: jsonb('suggestion').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('timeline_moment_presentations_team_cache_unq').on(
      table.teamId,
      table.cacheFingerprint,
    ),
    index('timeline_moment_presentations_team_moment_idx').on(table.teamId, table.momentKey),
    index('timeline_moment_presentations_team_model_prompt_idx').on(
      table.teamId,
      table.model,
      table.promptVersion,
    ),
  ],
);
