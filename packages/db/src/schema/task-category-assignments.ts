import { sql } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const taskCategoryAssignments = pgTable(
  'task_category_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').notNull(),
    category: text('category'),
    source: text('source').notNull(),
    mode: text('mode').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    confidence: doublePrecision('confidence'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    taxonomyVersion: text('taxonomy_version'),
    inputHash: text('input_hash'),
    outcome: text('outcome').notNull(),
    failureCode: text('failure_code'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'task_category_assignments_team_entity_fk',
      columns: [table.teamId, table.entityId],
      foreignColumns: [entities.teamId, entities.id],
    }).onDelete('cascade'),
    index('task_category_assignments_team_entity_created_idx').on(
      table.teamId,
      table.entityId,
      table.createdAt,
      table.id,
    ),
    index('task_category_assignments_team_versions_outcome_idx').on(
      table.teamId,
      table.taxonomyVersion,
      table.promptVersion,
      table.model,
      table.outcome,
    ),
    index('task_category_assignments_input_hash_idx')
      .on(table.teamId, table.entityId, table.inputHash)
      .where(sql`${table.inputHash} IS NOT NULL`),
    check('task_category_assignments_source_chk', sql`${table.source} IN ('llm', 'user')`),
    check(
      'task_category_assignments_category_chk',
      sql`${table.category} IS NULL OR ${table.category} IN ('engineering', 'product', 'design', 'research', 'sales', 'marketing', 'customer_success', 'operations', 'finance', 'legal_compliance', 'people_recruiting', 'it_security', 'strategy_planning', 'administrative', 'other')`,
    ),
    check('task_category_assignments_mode_chk', sql`${table.mode} IN ('automatic', 'manual')`),
    check(
      'task_category_assignments_outcome_chk',
      sql`${table.outcome} IN ('applied', 'discarded_stale', 'discarded_human_override', 'failed')`,
    ),
    check(
      'task_category_assignments_confidence_chk',
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`,
    ),
  ],
);

export const taskCategoryProjectInvalidations = pgTable(
  'task_category_project_invalidations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    projectVersion: text('project_version').notNull(),
    afterTaskId: uuid('after_task_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'task_category_project_invalidations_team_project_fk',
      columns: [table.teamId, table.projectId],
      foreignColumns: [entities.teamId, entities.id],
    }).onDelete('cascade'),
    uniqueIndex('task_category_project_invalidations_team_project_unq').on(
      table.teamId,
      table.projectId,
    ),
    index('task_category_project_invalidations_created_idx').on(table.createdAt, table.id),
  ],
);

export const taskCategoryFilterVersions = pgTable(
  'task_category_filter_versions',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    version: bigint('version', { mode: 'number' }).default(1).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.category] }),
    check(
      'task_category_filter_versions_category_chk',
      sql`${table.category} IN ('engineering', 'product', 'design', 'research', 'sales', 'marketing', 'customer_success', 'operations', 'finance', 'legal_compliance', 'people_recruiting', 'it_security', 'strategy_planning', 'administrative', 'other', 'uncategorized')`,
    ),
  ],
);
