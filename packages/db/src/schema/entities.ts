import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
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
    // vs decision). `suggested` is reserved for agent-created rows pending
    // human approval.
    status: text('status').notNull().default('open'),
    stage: text('stage'),
    priority: smallint('priority'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    sourceEventId: uuid('source_event_id').references(() => rawEvents.id, { onDelete: 'set null' }),
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
    index('entities_team_active_idx')
      .on(table.teamId)
      .where(sql`${table.archivedAt} IS NULL`),
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
