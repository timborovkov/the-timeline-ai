import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from './teams.js';
import { users } from './users.js';

// Phase 13 — generic trust audit log for sensitive reads/actions. This is
// intentionally separate from integration_audit_log, which remains provider
// sync history.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_team_created_idx').on(table.teamId, table.createdAt),
    index('audit_log_actor_created_idx').on(table.actorUserId, table.createdAt),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
  ],
);
