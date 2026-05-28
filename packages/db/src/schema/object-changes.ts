import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Immutable audit log of changes to workspace objects (entities). Every
// manual edit, every applied agent suggestion, and every system-triggered
// status change writes one row per modified field. The row links to the
// timeline event we also write so the agent's `recent_changes` tool and
// the object page's "changes" pane share one source of truth.
export const objectChangeActorKind = pgEnum('object_change_actor_kind', [
  'user',
  'agent',
  'system',
]);

// Agent-proposed changes land as `suggested` and only flip to `applied` once
// a human accepts them. `rejected` is terminal — rejected suggestions stay
// visible in the audit trail so we can measure agent quality over time.
export const objectChangeStatus = pgEnum('object_change_status', [
  'applied',
  'suggested',
  'rejected',
]);

export const objectChanges = pgTable(
  'object_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorKind: objectChangeActorKind('actor_kind').notNull(),
    status: objectChangeStatus('status').notNull().default('applied'),
    field: text('field').notNull(),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    sourceEventId: uuid('source_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('object_changes_team_entity_changed_idx').on(
      table.teamId,
      table.entityId,
      table.changedAt,
    ),
    index('object_changes_team_entity_changed_id_idx').on(
      table.teamId,
      table.entityId,
      table.changedAt,
      table.id,
    ),
    index('object_changes_team_status_idx').on(table.teamId, table.status),
  ],
);
