import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { agentSuggestions } from '#src/schema/agent-suggestions.js';
import { entities, entityType } from '#src/schema/entities.js';
import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';

// A cluster is the real-world work artifact that source evidence points at:
// an incident, contract, deal, party, client relationship, decision, task, etc.
// Members and anchors are deliberately separate so evidence can be related
// without becoming authoritative over lifecycle state.
export const artifactClusterStatus = pgEnum('artifact_cluster_status', [
  'open',
  'active',
  'blocked',
  'resolved',
  'cancelled',
  'archived',
]);

export const artifactEvidenceRole = pgEnum('artifact_evidence_role', [
  'report',
  'discussion',
  'error',
  'issue',
  'implementation',
  'review',
  'release',
  'document',
  'approval',
  'signature',
  'payment',
  'schedule',
  'rsvp',
  'decision',
  'lifecycle_update',
  'related_context',
]);

export const artifactEvidenceStrength = pgEnum('artifact_evidence_strength', [
  'hard',
  'provider',
  'structured',
  'semantic',
  'human',
]);

export const artifactClusters = pgTable(
  'artifact_clusters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    artifactType: entityType('artifact_type').notNull(),
    canonicalName: text('canonical_name').notNull(),
    status: artifactClusterStatus('status').notNull().default('open'),
    canonicalEntityId: uuid('canonical_entity_id').references(() => entities.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('artifact_clusters_team_type_status_idx').on(
      table.teamId,
      table.artifactType,
      table.status,
    ),
    index('artifact_clusters_team_entity_idx').on(table.teamId, table.canonicalEntityId),
    uniqueIndex('artifact_clusters_team_entity_unq')
      .on(table.teamId, table.canonicalEntityId)
      .where(sql`${table.canonicalEntityId} IS NOT NULL`),
  ],
);

export const artifactClusterMembers = pgTable(
  'artifact_cluster_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => artifactClusters.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'cascade' }),
    suggestionId: uuid('suggestion_id').references(() => agentSuggestions.id, {
      onDelete: 'cascade',
    }),
    provider: text('provider'),
    externalObjectId: text('external_object_id'),
    role: artifactEvidenceRole('role').notNull(),
    strength: artifactEvidenceStrength('strength').notNull(),
    authoritative: boolean('authoritative').notNull().default(false),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('artifact_cluster_members_team_cluster_idx').on(table.teamId, table.clusterId),
    index('artifact_cluster_members_team_raw_event_idx').on(table.teamId, table.rawEventId),
    index('artifact_cluster_members_team_entity_idx').on(table.teamId, table.entityId),
    index('artifact_cluster_members_team_provider_external_idx').on(
      table.teamId,
      table.provider,
      table.externalObjectId,
    ),
    uniqueIndex('artifact_cluster_members_event_cluster_unq')
      .on(table.teamId, table.clusterId, table.rawEventId)
      .where(sql`${table.rawEventId} IS NOT NULL`),
  ],
);

export const artifactClusterAnchors = pgTable(
  'artifact_cluster_anchors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => artifactClusters.id, { onDelete: 'cascade' }),
    anchorType: text('anchor_type').notNull(),
    anchorValue: text('anchor_value').notNull(),
    strength: artifactEvidenceStrength('strength').notNull(),
    sourceRawEventId: uuid('source_raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('artifact_cluster_anchors_team_anchor_unq').on(
      table.teamId,
      table.anchorType,
      table.anchorValue,
    ),
    index('artifact_cluster_anchors_team_cluster_idx').on(table.teamId, table.clusterId),
  ],
);
