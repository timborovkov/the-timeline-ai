import { index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { entities } from './entities.js';
import { teams } from './teams.js';
import { users } from './users.js';

// Explicit, human/agent-authored links between workspace objects. The
// timeline's co-occurrence signal stays as a derived view (computed on read
// from fact_entities); this table is the durable, editable relationship
// graph that boards and object pages render.
export const relationshipKind = pgEnum('relationship_kind', [
  'parent',
  'child',
  'related',
  'blocks',
  'blocked_by',
  'duplicate_of',
  'linked',
]);

export const entityRelationships = pgTable(
  'entity_relationships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    fromEntityId: uuid('from_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    toEntityId: uuid('to_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    kind: relationshipKind('kind').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Same edge twice (same kind) is a no-op — uniqueness prevents
    // accidental dupes when the agent re-proposes a link humans already
    // accepted.
    uniqueIndex('entity_relationships_edge_unq').on(
      table.fromEntityId,
      table.toEntityId,
      table.kind,
    ),
    index('entity_relationships_team_idx').on(table.teamId),
    index('entity_relationships_from_idx').on(table.fromEntityId),
    index('entity_relationships_to_idx').on(table.toEntityId),
    index('entity_relationships_team_from_created_idx').on(
      table.teamId,
      table.fromEntityId,
      table.createdAt,
      table.id,
    ),
    index('entity_relationships_team_to_created_idx').on(
      table.teamId,
      table.toEntityId,
      table.createdAt,
      table.id,
    ),
  ],
);
