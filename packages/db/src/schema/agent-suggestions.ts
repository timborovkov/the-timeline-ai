import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { eventVisibility, rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const agentSuggestionSource = pgEnum('agent_suggestion_source', ['chat', 'background']);

export const agentSuggestionStatus = pgEnum('agent_suggestion_status', [
  'pending',
  'partially_resolved',
  'accepted',
  'rejected',
  'superseded',
]);

export const agentSuggestionItemStatus = pgEnum('agent_suggestion_item_status', [
  'pending',
  'accepted',
  'rejected',
  'failed',
  'superseded',
]);

export const agentSuggestionOperation = pgEnum('agent_suggestion_operation', [
  'create',
  'update',
  'archive_or_cancel',
  'merge',
]);

export const agentSuggestionTargetKind = pgEnum('agent_suggestion_target_kind', [
  'object',
  'task',
  'calendar_event',
  'identity_facet',
  'object_note',
  'object_relationship',
  'object_merge',
  'board_membership',
  'board_item_update',
]);

export const agentSuggestions = pgTable(
  'agent_suggestions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    source: agentSuggestionSource('source').notNull(),
    status: agentSuggestionStatus('status').notNull().default('pending'),
    title: text('title').notNull(),
    summary: text('summary'),
    reason: text('reason'),
    confidence: text('confidence').notNull().default('medium'),
    dedupeKey: text('dedupe_key').notNull(),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityOwnerUserId: uuid('visibility_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    metadata: jsonb('metadata').notNull().default({}),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('agent_suggestions_team_dedupe_unq').on(table.teamId, table.dedupeKey),
    index('agent_suggestions_team_status_idx').on(table.teamId, table.status, table.createdAt),
    index('agent_suggestions_team_visibility_owner_idx').on(
      table.teamId,
      table.visibilityOwnerUserId,
    ),
  ],
);

export const agentSuggestionItems = pgTable(
  'agent_suggestion_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => agentSuggestions.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    status: agentSuggestionItemStatus('status').notNull().default('pending'),
    operation: agentSuggestionOperation('operation').notNull(),
    targetKind: agentSuggestionTargetKind('target_kind').notNull(),
    targetId: uuid('target_id'),
    resultId: uuid('result_id'),
    title: text('title').notNull(),
    description: text('description'),
    dedupeKey: text('dedupe_key').notNull(),
    proposedPayload: jsonb('proposed_payload').notNull(),
    failureReason: text('failure_reason'),
    supersededByItemId: uuid('superseded_by_item_id').references(
      (): AnyPgColumn => agentSuggestionItems.id,
      { onDelete: 'set null' },
    ),
    supersededReason: text('superseded_reason'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('agent_suggestion_items_suggestion_dedupe_unq').on(
      table.suggestionId,
      table.dedupeKey,
    ),
    index('agent_suggestion_items_team_status_idx').on(table.teamId, table.status),
    index('agent_suggestion_items_team_target_idx').on(
      table.teamId,
      table.targetKind,
      table.targetId,
    ),
    uniqueIndex('agent_suggestion_items_team_id_unq').on(table.teamId, table.id),
  ],
);

export const agentSuggestionEvidence = pgTable(
  'agent_suggestion_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    suggestionId: uuid('suggestion_id')
      .notNull()
      .references(() => agentSuggestions.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id')
      .notNull()
      .references(() => rawEvents.id, { onDelete: 'cascade' }),
    quote: text('quote'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('agent_suggestion_evidence_suggestion_event_unq').on(
      table.suggestionId,
      table.rawEventId,
    ),
    index('agent_suggestion_evidence_team_event_idx').on(table.teamId, table.rawEventId),
    index('agent_suggestion_evidence_quote_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.quote})`,
    ),
  ],
);
