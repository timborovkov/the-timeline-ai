import { index, pgEnum, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { eventVisibility } from './raw-events.js';
import { teams } from './teams.js';
import { users } from './users.js';

export const visibilityDefaultSource = pgEnum('visibility_default_source', [
  'team',
  'web',
  'telegram',
  'email',
  'document',
  'meeting',
  'integration',
  'calendar',
]);

export const teamVisibilityDefaults = pgTable(
  'team_visibility_defaults',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    source: visibilityDefaultSource('source').notNull(),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    sourceOwnerUserId: uuid('source_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.source] }),
    index('team_visibility_defaults_owner_idx').on(table.teamId, table.sourceOwnerUserId),
  ],
);
