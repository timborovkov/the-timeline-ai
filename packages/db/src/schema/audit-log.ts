import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { eventVisibility } from './raw-events.js';
import { teams } from './teams.js';
import { users } from './users.js';

// Phase 13 — generic trust audit log.
//
// This is append-only product audit history for sensitive reads and
// security-relevant actions. Provider sync history stays in
// `integration_audit_log`.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    targetVisibility: eventVisibility('target_visibility'),
    targetOwnerUserId: uuid('target_owner_user_id').references(() => users.id),
    targetVisibilityUserIds: uuid('target_visibility_user_ids').array(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_team_created_idx').on(table.teamId, table.createdAt),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
    index('audit_log_actor_idx').on(table.actorUserId),
  ],
);
