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

import { agentSuggestionItems } from '#src/schema/agent-suggestions.js';
import { entities } from '#src/schema/entities.js';
import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const boardTemplateKind = pgEnum('board_template_kind', [
  'pipeline',
  'task_board',
  'catalog',
  'custom',
]);

export const boardLaneKind = pgEnum('board_lane_kind', [
  'active',
  'done',
  'terminal',
  'lost',
  'blocked',
]);

export const boardItemChangeActorKind = pgEnum('board_item_change_actor_kind', [
  'user',
  'agent',
  'system',
]);

export const boardItemChangeStatus = pgEnum('board_item_change_status', [
  'applied',
  'suggested',
  'rejected',
]);

export const boards = pgTable(
  'boards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    purpose: text('purpose').notNull().default(''),
    templateKind: boardTemplateKind('template_kind').notNull().default('custom'),
    recommendedObjectTypes: jsonb('recommended_object_types').notNull().default([]),
    strictObjectTypes: boolean('strict_object_types').notNull().default(false),
    candidateFilter: jsonb('candidate_filter').notNull().default({}),
    isShared: boolean('is_shared').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('boards_team_archived_idx').on(table.teamId, table.archivedAt),
    index('boards_team_updated_idx').on(table.teamId, table.updatedAt),
  ],
);

export const boardLanes = pgTable(
  'board_lanes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    kind: boardLaneKind('kind'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('board_lanes_team_board_position_idx').on(table.teamId, table.boardId, table.position),
  ],
);

export const boardItems = pgTable(
  'board_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    laneId: uuid('lane_id').references(() => boardLanes.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    responsibleUserId: uuid('responsible_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    priority: integer('priority'),
    nextStep: text('next_step'),
    notes: text('notes'),
    customFields: jsonb('custom_fields').notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('board_items_team_board_entity_active_unq')
      .on(table.teamId, table.boardId, table.entityId)
      .where(sql`${table.archivedAt} IS NULL`),
    index('board_items_team_board_lane_position_idx').on(
      table.teamId,
      table.boardId,
      table.laneId,
      table.position,
    ),
    index('board_items_team_entity_idx').on(table.teamId, table.entityId),
    index('board_items_team_responsible_idx').on(table.teamId, table.responsibleUserId),
    index('board_items_team_due_idx').on(table.teamId, table.dueAt),
  ],
);

export const boardItemChanges = pgTable(
  'board_item_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    boardItemId: uuid('board_item_id').references(() => boardItems.id, { onDelete: 'set null' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    actorKind: boardItemChangeActorKind('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: boardItemChangeStatus('status').notNull().default('applied'),
    field: text('field').notNull(),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    sourceEventId: uuid('source_event_id').references(() => rawEvents.id, { onDelete: 'set null' }),
    suggestionItemId: uuid('suggestion_item_id').references(() => agentSuggestionItems.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('board_item_changes_team_item_changed_idx').on(
      table.teamId,
      table.boardItemId,
      table.changedAt,
    ),
    index('board_item_changes_team_board_changed_idx').on(
      table.teamId,
      table.boardId,
      table.changedAt,
    ),
    index('board_item_changes_team_status_idx').on(table.teamId, table.status),
  ],
);

export const boardPins = pgTable(
  'board_pins',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('board_pins_team_user_board_unq').on(table.teamId, table.userId, table.boardId),
    index('board_pins_team_user_position_idx').on(table.teamId, table.userId, table.position),
  ],
);
