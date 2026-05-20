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

import { teams } from './teams';

export const entityType = pgEnum('entity_type', ['person', 'company', 'project', 'topic', 'other']);

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('entities_team_idx').on(table.teamId),
    index('entities_team_type_idx').on(table.teamId, table.type),
    // Case-insensitive uniqueness on (team, type, canonical name). Scoped to
    // active (non-merged) rows so merges don't create permanent collisions.
    // Includes `type` so cross-type same-name entities coexist legitimately
    // (a "person" Apple and a "company" Apple are different real-world
    // things), and so the resolver's race-safe insert+re-SELECT can never
    // mis-bind a mention to an entity of the wrong type.
    uniqueIndex('entities_team_type_canonical_name_unq')
      .on(table.teamId, table.type, sql`lower(${table.canonicalName})`)
      .where(sql`${table.mergedIntoId} IS NULL`),
    // GIN over aliases for alias-membership lookup. Team scoping happens via
    // the btree (entities_team_idx) — Postgres bitmap-ands the two.
    index('entities_aliases_gin').using('gin', sql`${table.aliases} jsonb_path_ops`),
  ],
);
