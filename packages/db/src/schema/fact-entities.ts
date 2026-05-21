import { index, pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

import { entities } from './entities.js';
import { facts } from './facts.js';

export const factEntityRole = pgEnum('fact_entity_role', ['subject', 'object', 'topic']);

export const factEntities = pgTable(
  'fact_entities',
  {
    factId: uuid('fact_id')
      .notNull()
      .references(() => facts.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    role: factEntityRole('role').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.factId, table.entityId, table.role] }),
    index('fact_entities_entity_idx').on(table.entityId),
  ],
);
