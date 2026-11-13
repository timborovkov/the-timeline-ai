import { sql } from 'drizzle-orm';
import {
  uniqueIndex,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';

/** Durable cursor and diagnostics; never contains source text. */
export const engineMaintenanceRuns = pgTable(
  'engine_maintenance_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('running'),
    engineVersion: text('engine_version').notNull(),
    cursor: uuid('cursor'),
    leaseOwner: uuid('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    examined: integer('examined').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('engine_maintenance_team_kind_idx').on(table.teamId, table.kind, table.startedAt),
    uniqueIndex('engine_maintenance_active_idx')
      .on(table.teamId, table.kind)
      .where(sql`${table.status} IN ('running','paused','failed')`),
  ],
);
