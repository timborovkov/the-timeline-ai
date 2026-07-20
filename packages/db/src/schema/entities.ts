import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Phase 8 widens this so a single `entities` table backs every durable
// workspace object — not just extraction artifacts. New values are appended;
// existing values keep their meaning. App-layer code validates per-type
// status/stage vocabularies (free-form `text` columns).
export const entityType = pgEnum('entity_type', [
  'person',
  'company',
  'project',
  'topic',
  'other',
  'deal',
  'vendor',
  'incident',
  'document',
  'decision',
  'hiring_loop',
  'task',
  'follow_up',
  'link',
]);

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    type: entityType('type').notNull(),
    canonicalName: text('canonical_name').notNull(),
    aliases: jsonb('aliases')
      .notNull()
      .default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').notNull().default({}),
    // Soft-delete via merge: when this entity has been merged into another,
    // mergedIntoId points at the survivor. Active entities have this NULL.
    // Restrict deletes so a hard-delete of a merge target cannot silently
    // re-activate merged descendants (which would then collide on the
    // partial unique index entities_team_canonical_name_unq) — callers must
    // walk the chain deliberately.
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => entities.id, {
      onDelete: 'restrict',
    }),
    // Phase 8 — workspace-object fields. All nullable / safely-defaulted so
    // existing rows keep working with no backfill. Status vocabularies are
    // validated in the app layer because they differ by type (deal vs task
    // vs decision). Pending agent proposals now live in agent_suggestions rows
    // projected from reconciliation outputs; sourceEventId/agentSuggested below
    // remain legacy compatibility columns until the cutover migration drops or
    // formally archives them.
    status: text('status').notNull().default('open'),
    stage: text('stage'),
    priority: smallint('priority'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    taskCategory: text('task_category'),
    taskCategoryMode: text('task_category_mode'),
    taskCategorySource: text('task_category_source'),
    taskCategoryStatus: text('task_category_status'),
    taskCategoryAppliedInputHash: text('task_category_applied_input_hash'),
    taskCategoryRequestedInputHash: text('task_category_requested_input_hash'),
    taskCategoryTaxonomyVersion: text('task_category_taxonomy_version'),
    taskCategoryUpdatedAt: timestamp('task_category_updated_at', { withTimezone: true }),
    // Legacy provenance pointer. New canonical object writes keep this NULL and
    // cite reconciliation output source refs instead.
    sourceEventId: uuid('source_event_id').references(() => rawEvents.id, { onDelete: 'set null' }),
    // Legacy proposal flag. New proposal state is projection-owned; shared read
    // models suppress stored true values so UI does not promote this column.
    agentSuggested: boolean('agent_suggested').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('entities_team_idx').on(table.teamId),
    index('entities_team_type_idx').on(table.teamId, table.type),
    index('entities_team_type_status_idx').on(table.teamId, table.type, table.status),
    index('entities_team_owner_idx').on(table.teamId, table.ownerUserId),
    index('entities_team_assignee_idx').on(table.teamId, table.assigneeUserId),
    index('entities_team_due_idx').on(table.teamId, table.dueAt),
    index('entities_team_task_category_active_updated_id_idx')
      .on(table.teamId, table.type, table.taskCategory, table.updatedAt, table.id)
      .where(sql`${table.archivedAt} IS NULL AND ${table.mergedIntoId} IS NULL`),
    index('entities_task_category_pending_recovery_idx').on(table.id, table.taskCategoryUpdatedAt)
      .where(sql`${table.taskCategoryMode} = 'automatic'
        AND ${table.taskCategoryStatus} = 'pending'
        AND ${table.taskCategoryRequestedInputHash} IS NOT NULL
        AND ${table.archivedAt} IS NULL
        AND ${table.mergedIntoId} IS NULL`),
    index('entities_team_task_category_pending_idx')
      .on(table.teamId, table.id)
      .where(
        sql`${table.taskCategoryStatus} = 'pending' AND ${table.archivedAt} IS NULL AND ${table.mergedIntoId} IS NULL`,
      ),
    index('entities_team_active_idx')
      .on(table.teamId)
      .where(sql`${table.archivedAt} IS NULL`),
    index('entities_team_type_status_active_updated_id_idx')
      .on(table.teamId, table.type, table.status, table.updatedAt, table.id)
      .where(sql`${table.archivedAt} IS NULL AND ${table.mergedIntoId} IS NULL`),
    index('entities_team_type_active_updated_id_idx')
      .on(table.teamId, table.type, table.updatedAt, table.id)
      .where(sql`${table.archivedAt} IS NULL AND ${table.mergedIntoId} IS NULL`),
    index('entities_team_lower_canonical_name_pattern_idx')
      .on(table.teamId, sql`lower(${table.canonicalName}) text_pattern_ops`)
      .where(sql`${table.mergedIntoId} IS NULL`),
    index('entities_canonical_name_tsv_idx')
      .using('gin', sql`to_tsvector('simple', ${table.canonicalName})`)
      .where(sql`${table.mergedIntoId} IS NULL`),
    // Case-insensitive uniqueness on (team, type, canonical name). Scoped to
    // active (non-merged) rows so merges don't create permanent collisions.
    // Includes `type` so cross-type same-name entities coexist legitimately
    // (a "person" Apple and a "company" Apple are different real-world
    // things), and so the resolver's race-safe insert+re-SELECT can never
    // mis-bind a mention to an entity of the wrong type.
    //
    // Phase 8 originally wanted to allow user-authored types (task,
    // follow_up, deal, ...) to repeat canonical names by narrowing this
    // predicate to extraction-derived types only. Postgres rejects any
    // enum literal in an index predicate as a non-IMMUTABLE function
    // call (SQLSTATE 42P17), so the predicate stays as just `mergedIntoId
    // IS NULL` — same shape as the original 0005 index. The 23505
    // duplicate-name violation now surfaces for user-authored types too;
    // createObjectAction maps it to a friendly message and the UI can
    // disambiguate. Follow-up tracked in todo.md.
    uniqueIndex('entities_team_type_canonical_name_unq')
      .on(table.teamId, table.type, sql`lower(${table.canonicalName})`)
      .where(sql`${table.mergedIntoId} IS NULL`),
    uniqueIndex('entities_team_id_unq').on(table.teamId, table.id),
    // GIN over aliases for alias-membership lookup. Team scoping happens via
    // the btree (entities_team_idx) — Postgres bitmap-ands the two.
    index('entities_aliases_gin').using('gin', sql`${table.aliases} jsonb_path_ops`),
    check(
      'entities_task_category_non_task_null_chk',
      sql`${table.type} = 'task' OR (
        ${table.taskCategory} IS NULL
        AND ${table.taskCategoryMode} IS NULL
        AND ${table.taskCategorySource} IS NULL
        AND ${table.taskCategoryStatus} IS NULL
        AND ${table.taskCategoryAppliedInputHash} IS NULL
        AND ${table.taskCategoryRequestedInputHash} IS NULL
        AND ${table.taskCategoryTaxonomyVersion} IS NULL
        AND ${table.taskCategoryUpdatedAt} IS NULL
      )`,
    ),
    check(
      'entities_task_category_mode_chk',
      sql`${table.taskCategoryMode} IS NULL OR ${table.taskCategoryMode} IN ('automatic', 'manual')`,
    ),
    check(
      'entities_task_category_source_chk',
      sql`${table.taskCategorySource} IS NULL OR ${table.taskCategorySource} IN ('llm', 'user')`,
    ),
    check(
      'entities_task_category_status_chk',
      sql`${table.taskCategoryStatus} IS NULL OR ${table.taskCategoryStatus} IN ('pending', 'ready', 'failed')`,
    ),
    check(
      'entities_task_category_value_chk',
      sql`${table.taskCategory} IS NULL OR ${table.taskCategory} IN ('engineering', 'product', 'design', 'research', 'sales', 'marketing', 'customer_success', 'operations', 'finance', 'legal_compliance', 'people_recruiting', 'it_security', 'strategy_planning', 'administrative', 'other')`,
    ),
    check(
      'entities_task_category_manual_state_chk',
      sql`${table.taskCategoryMode} IS DISTINCT FROM 'manual' OR (
        ${table.taskCategory} IS NOT NULL
        AND ${table.taskCategorySource} = 'user'
        AND ${table.taskCategoryStatus} = 'ready'
        AND ${table.taskCategoryRequestedInputHash} IS NULL
        AND ${table.taskCategoryAppliedInputHash} IS NULL
        AND ${table.taskCategoryTaxonomyVersion} IS NOT NULL
      )`,
    ),
    check(
      'entities_task_category_automatic_ready_chk',
      sql`NOT (${table.taskCategoryMode} = 'automatic' AND ${table.taskCategoryStatus} = 'ready') OR (
        ${table.taskCategory} IS NOT NULL
        AND ${table.taskCategorySource} = 'llm'
        AND ${table.taskCategoryAppliedInputHash} IS NOT NULL
        AND ${table.taskCategoryRequestedInputHash} IS NULL
        AND ${table.taskCategoryTaxonomyVersion} IS NOT NULL
      )`,
    ),
    check(
      'entities_task_category_request_state_chk',
      sql`(
        ${table.taskCategoryMode} = 'automatic'
        AND ${table.taskCategoryStatus} = 'pending'
        AND ${table.taskCategoryRequestedInputHash} IS NOT NULL
      ) OR ${table.taskCategoryRequestedInputHash} IS NULL`,
    ),
    // Phase 11 — Integration sync upsert. Partial unique index so the
    // event-writer can `INSERT ... ON CONFLICT (...) DO UPDATE` per
    // external resource in one query. Only covers integration-mapped
    // rows; regular workspace objects don't trip this constraint.
    uniqueIndex('entities_integration_external_id_unq')
      .on(
        table.teamId,
        sql`((${table.metadata} ->> 'integration_provider'))`,
        sql`((${table.metadata} ->> 'integration_external_id'))`,
      )
      .where(sql`${table.metadata} ? 'integration_external_id'`),
  ],
);

export const objectPins = pgTable(
  'object_pins',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.teamId, table.entityId],
      foreignColumns: [entities.teamId, entities.id],
      name: 'object_pins_team_entity_fk',
    }).onDelete('cascade'),
    uniqueIndex('object_pins_team_user_entity_unq').on(table.teamId, table.userId, table.entityId),
    index('object_pins_team_user_position_idx').on(table.teamId, table.userId, table.position),
  ],
);
