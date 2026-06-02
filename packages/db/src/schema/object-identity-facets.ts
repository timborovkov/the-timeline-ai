import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const identityFacetKind = pgEnum('identity_facet_kind', [
  'email',
  'phone',
  'telegram',
  'slack',
  'github',
  'timeline_user',
  'other',
]);

export const identityFacetStatus = pgEnum('identity_facet_status', ['approved', 'archived']);

export const identityFacetSource = pgEnum('identity_facet_source', [
  'manual',
  'agent_approved',
  'integration',
  'system',
]);

export const objectIdentityFacets = pgTable(
  'object_identity_facets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    kind: identityFacetKind('kind').notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    provider: text('provider'),
    externalId: text('external_id'),
    linkedUserId: uuid('linked_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: identityFacetSource('source').notNull().default('manual'),
    status: identityFacetStatus('status').notNull().default('approved'),
    metadata: jsonb('metadata').notNull().default({}),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('object_identity_facets_team_entity_idx').on(table.teamId, table.entityId),
    index('object_identity_facets_team_kind_value_idx').on(
      table.teamId,
      table.kind,
      table.normalizedValue,
    ),
    index('object_identity_facets_team_external_idx').on(
      table.teamId,
      table.kind,
      table.provider,
      table.externalId,
    ),
    index('object_identity_facets_team_linked_user_idx').on(table.teamId, table.linkedUserId),
    uniqueIndex('object_identity_facets_team_kind_value_unq')
      .on(table.teamId, table.kind, table.normalizedValue)
      .where(sql`${table.status} = 'approved'`),
    uniqueIndex('object_identity_facets_team_external_unq')
      .on(table.teamId, table.kind, table.provider, table.externalId)
      .where(sql`${table.status} = 'approved' AND ${table.externalId} IS NOT NULL`),
    uniqueIndex('object_identity_facets_team_linked_user_unq')
      .on(table.teamId, table.linkedUserId)
      .where(sql`${table.status} = 'approved' AND ${table.kind} = 'timeline_user'`),
  ],
);
