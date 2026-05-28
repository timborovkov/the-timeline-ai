import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Per-user, per-object last-visit timestamp. Drives the "changes since your
// last visit" banner on object pages and the unread badge on the objects
// list. Composite PK + cascading FKs make membership churn self-cleaning.
export const objectViews = pgTable(
  'object_views',
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
    lastVisitedAt: timestamp('last_visited_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId, table.entityId] })],
);
