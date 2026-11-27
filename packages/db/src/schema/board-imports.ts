import { inArray, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { BOARD_IMPORT_PROVIDERS } from '#src/integration-providers.js';
import { boards, boardItems } from '#src/schema/boards.js';
import { entities } from '#src/schema/entities.js';
import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';
export const boardImportRules = pgTable(
  'board_import_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    authorizedBy: uuid('authorized_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    resourceId: text('resource_id').notNull(),
    boardId: uuid('board_id').notNull(),
    projectId: uuid('project_id'),
    importIssues: boolean('import_issues').notNull().default(false),
    mergedPrs: boolean('merged_prs').notNull().default(false),
    mergesSince: timestamp('merges_since', { withTimezone: true }).notNull().defaultNow(),
    stageLanes: jsonb('stage_lanes').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    unique().on(t.teamId, t.provider, t.externalAccountId, t.resourceId),
    unique().on(t.teamId, t.id),
    check(
      'board_import_rules_provider_check',
      inArray(t.provider, [...BOARD_IMPORT_PROVIDERS]).inlineParams(),
    ),
    foreignKey({
      columns: [t.teamId, t.boardId],
      foreignColumns: [boards.teamId, boards.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.teamId, t.projectId],
      foreignColumns: [entities.teamId, entities.id],
    }),
  ],
);
export const boardImportLinks = pgTable(
  'board_import_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').notNull(),
    ruleId: uuid('rule_id').notNull(),
    recordKey: text('record_key').notNull(),
    entityId: uuid('entity_id').notNull(),
    itemId: uuid('item_id'),
    field: text('field').notNull(),
    state: text('state').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    sourceAt: timestamp('source_at', { withTimezone: true }).notNull(),
    sourceUrl: text('source_url'),
  },
  (t) => [
    unique().on(t.ruleId, t.recordKey),
    check('board_import_links_field_check', sql`${t.field} in ('status','lane','reference')`),
    check('board_import_links_state_check', sql`${t.state} in ('active','paused','unlinked')`),
    uniqueIndex('board_import_status_owner')
      .on(t.teamId, t.entityId)
      .where(sql`${t.field}='status' and ${t.state}='active'`),
    uniqueIndex('board_import_lane_owner')
      .on(t.teamId, t.itemId)
      .where(sql`${t.field}='lane' and ${t.state}='active'`),
    foreignKey({
      columns: [t.teamId, t.ruleId],
      foreignColumns: [boardImportRules.teamId, boardImportRules.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.teamId, t.entityId],
      foreignColumns: [entities.teamId, entities.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.teamId, t.itemId],
      foreignColumns: [boardItems.teamId, boardItems.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.teamId, t.sourceEventId],
      foreignColumns: [rawEvents.teamId, rawEvents.id],
    }).onDelete('cascade'),
  ],
);
export const boardImportEffects = pgTable(
  'board_import_effects',
  {
    teamId: uuid('team_id').notNull(),
    state: text('state').notNull(),
    waitingOn: text('waiting_on').array().notNull().default([]),
    ruleId: uuid('rule_id').notNull(),
    recordKey: text('record_key').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    entityId: uuid('entity_id'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ruleId, t.recordKey, t.sourceEventId] }),
    check('board_import_effects_state_check', sql`${t.state} in ('applied','waiting','skipped')`),
    index('board_import_effect_event_idx').on(t.teamId, t.sourceEventId),
    index('board_import_waiting_idx')
      .using('gin', t.waitingOn)
      .where(sql`${t.state}='waiting'`),
    foreignKey({
      columns: [t.teamId, t.ruleId],
      foreignColumns: [boardImportRules.teamId, boardImportRules.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.teamId, t.sourceEventId],
      foreignColumns: [rawEvents.teamId, rawEvents.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.teamId, t.entityId],
      foreignColumns: [entities.teamId, entities.id],
    }).onDelete('cascade'),
  ],
);
