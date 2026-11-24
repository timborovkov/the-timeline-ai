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

import {
  agentSuggestionItems,
  agentSuggestions,
  agentSuggestionTargetKind,
} from '#src/schema/agent-suggestions.js';
import { artifactClusters, artifactEvidenceStrength } from '#src/schema/artifact-clusters.js';
import { eventSource, eventVisibility, rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const reconciliationReplayState = pgEnum('reconciliation_replay_state', [
  'full',
  'degraded',
]);

export const reconciliationAnchorSource = pgEnum('reconciliation_anchor_source', [
  'adapter',
  'extractor',
  'model',
  'human',
]);

export const artifactAssociationRole = pgEnum('artifact_association_role', [
  'origin',
  'update',
  'lifecycle_update',
  'discussion',
  'blocker',
  'decision',
  'related_context',
  'contradiction',
  'correction',
  'evidence_only',
]);

export const artifactAssociationSource = pgEnum('artifact_association_source', [
  'hard_anchor',
  'structured_anchor',
  'model_candidate',
  'human',
  'authoritative_provider',
]);

export const reconciliationRunTrigger = pgEnum('reconciliation_run_trigger', [
  'raw_event',
  'evidence_batch',
  'cluster_replay',
  'manual_repair',
  'eval',
  'backfill',
]);

export const reconciliationRunStatus = pgEnum('reconciliation_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'superseded',
]);

export const reconciliationOutputKind = pgEnum('reconciliation_output_kind', [
  'direct_write',
  'approval_bundle',
  'observed_association',
  'no_action',
  'conflict',
  'eval_observation',
]);

export const reconciliationOutputTargetKind = pgEnum('reconciliation_output_target_kind', [
  ...agentSuggestionTargetKind.enumValues,
  'cluster_identity',
  'cluster_lifecycle',
] as [string, ...string[]]);

export const reconciliationOutputOperation = pgEnum('reconciliation_output_operation', [
  'create',
  'update',
  'archive_or_cancel',
  'merge',
  'link',
  'unlink',
  'supersede',
  'noop',
]);

export const reconciliationOutputStatus = pgEnum('reconciliation_output_status', [
  'pending',
  'applied',
  'approval_created',
  'rejected',
  'superseded',
  'failed',
]);

export const reconciliationProjectionOutboxAction = pgEnum(
  'reconciliation_projection_outbox_action',
  [
    'create_projection',
    'mark_applied',
    'mark_rejected',
    'mark_failed',
    'mark_superseded',
    'repair_projection',
  ],
);

export const reconciliationProjectionOutboxStatus = pgEnum(
  'reconciliation_projection_outbox_status',
  ['pending', 'processing', 'processed', 'failed'],
);

export const reconciliationEvidence = pgTable(
  'reconciliation_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id')
      .notNull()
      .references(() => rawEvents.id, { onDelete: 'cascade' }),
    sourcePayloadRef: text('source_payload_ref'),
    payloadDigest: text('payload_digest'),
    source: eventSource('source').notNull(),
    provider: text('provider'),
    externalObjectId: text('external_object_id'),
    externalEventId: text('external_event_id'),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityOwnerUserId: uuid('visibility_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    actor: jsonb('actor').notNull().default({}),
    contentDigest: text('content_digest').notNull(),
    title: text('title'),
    summary: text('summary'),
    sourceUrl: text('source_url'),
    metadata: jsonb('metadata').notNull().default({}),
    normalizerVersion: text('normalizer_version').notNull(),
    replayState: reconciliationReplayState('replay_state').notNull().default('full'),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reconciliation_evidence_team_dedupe_unq').on(table.teamId, table.dedupeKey),
    index('reconciliation_evidence_team_raw_version_idx').on(
      table.teamId,
      table.rawEventId,
      table.normalizerVersion,
    ),
    index('reconciliation_evidence_team_source_occurred_idx').on(
      table.teamId,
      table.source,
      table.occurredAt,
    ),
    index('reconciliation_evidence_team_visibility_owner_idx').on(
      table.teamId,
      table.visibilityOwnerUserId,
    ),
    index('reconciliation_evidence_payload_digest_idx').on(table.teamId, table.payloadDigest),
  ],
);

export const reconciliationEvidenceAnchors = pgTable(
  'reconciliation_evidence_anchors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    evidenceId: uuid('evidence_id')
      .notNull()
      .references(() => reconciliationEvidence.id, { onDelete: 'cascade' }),
    anchorType: text('anchor_type').notNull(),
    anchorValue: text('anchor_value').notNull(),
    strength: artifactEvidenceStrength('strength').notNull(),
    confidence: text('confidence').notNull().default('medium'),
    source: reconciliationAnchorSource('source').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reconciliation_evidence_anchors_team_evidence_anchor_unq').on(
      table.teamId,
      table.evidenceId,
      table.anchorType,
      table.anchorValue,
      table.source,
    ),
    uniqueIndex('reconciliation_evidence_anchors_team_dedupe_unq').on(
      table.teamId,
      table.dedupeKey,
    ),
    index('reconciliation_evidence_anchors_team_anchor_idx').on(
      table.teamId,
      table.anchorType,
      table.anchorValue,
    ),
  ],
);

export const artifactEvidenceAssociations = pgTable(
  'artifact_evidence_associations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => artifactClusters.id, { onDelete: 'cascade' }),
    evidenceId: uuid('evidence_id')
      .notNull()
      .references(() => reconciliationEvidence.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, { onDelete: 'cascade' }),
    role: artifactAssociationRole('role').notNull(),
    strength: artifactEvidenceStrength('strength').notNull(),
    confidence: text('confidence').notNull().default('medium'),
    associationSource: artifactAssociationSource('association_source').notNull(),
    rationale: text('rationale'),
    sourceRefs: jsonb('source_refs').notNull().default([]),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityOwnerUserId: uuid('visibility_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    visibilityFloor: eventVisibility('visibility_floor').notNull().default('team'),
    visibilityFloorOwnerUserId: uuid('visibility_floor_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    visibilityFloorUserIds: uuid('visibility_floor_user_ids').array(),
    metadata: jsonb('metadata').notNull().default({}),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('artifact_evidence_associations_cluster_evidence_role_unq').on(
      table.teamId,
      table.clusterId,
      table.evidenceId,
      table.role,
      table.associationSource,
    ),
    uniqueIndex('artifact_evidence_associations_team_dedupe_unq').on(table.teamId, table.dedupeKey),
    index('artifact_evidence_associations_team_cluster_idx').on(table.teamId, table.clusterId),
    index('artifact_evidence_associations_team_evidence_idx').on(table.teamId, table.evidenceId),
    index('artifact_evidence_associations_team_visibility_owner_idx').on(
      table.teamId,
      table.visibilityOwnerUserId,
    ),
    index('artifact_evidence_associations_team_visibility_floor_owner_idx').on(
      table.teamId,
      table.visibilityFloorOwnerUserId,
    ),
  ],
);

export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    trigger: reconciliationRunTrigger('trigger').notNull(),
    scope: text('scope').notNull(),
    status: reconciliationRunStatus('status').notNull().default('pending'),
    inputFingerprint: text('input_fingerprint').notNull(),
    engineVersion: text('engine_version').notNull(),
    modelVersions: jsonb('model_versions').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    metrics: jsonb('metrics').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('reconciliation_runs_team_status_idx').on(table.teamId, table.status, table.createdAt),
    index('reconciliation_runs_team_scope_idx').on(table.teamId, table.scope),
    uniqueIndex('reconciliation_runs_team_fingerprint_unq').on(
      table.teamId,
      table.inputFingerprint,
      table.engineVersion,
    ),
  ],
);

export const reconciliationOutputs = pgTable(
  'reconciliation_outputs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconciliationRuns.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id').references(() => artifactClusters.id, {
      onDelete: 'set null',
    }),
    outputKind: reconciliationOutputKind('output_kind').notNull(),
    targetKind: reconciliationOutputTargetKind('target_kind').notNull(),
    operation: reconciliationOutputOperation('operation').notNull(),
    targetId: uuid('target_id'),
    payload: jsonb('payload').notNull().default({}),
    authorityDecision: jsonb('authority_decision').notNull().default({}),
    confidence: text('confidence').notNull().default('medium'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    sourceRefs: jsonb('source_refs').notNull().default([]),
    sourcePayloadRefs: jsonb('source_payload_refs').notNull().default([]),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityOwnerUserId: uuid('visibility_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    visibilityFloor: eventVisibility('visibility_floor').notNull().default('team'),
    visibilityFloorOwnerUserId: uuid('visibility_floor_owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    visibilityFloorUserIds: uuid('visibility_floor_user_ids').array(),
    dedupeKey: text('dedupe_key').notNull(),
    status: reconciliationOutputStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reconciliation_outputs_team_dedupe_unq').on(table.teamId, table.dedupeKey),
    index('reconciliation_outputs_team_run_status_idx').on(table.teamId, table.runId, table.status),
    index('reconciliation_outputs_team_cluster_kind_status_idx').on(
      table.teamId,
      table.clusterId,
      table.outputKind,
      table.status,
    ),
    index('reconciliation_outputs_team_visibility_owner_idx').on(
      table.teamId,
      table.visibilityOwnerUserId,
    ),
    index('reconciliation_outputs_team_visibility_floor_owner_idx').on(
      table.teamId,
      table.visibilityFloorOwnerUserId,
    ),
  ],
);

export const reconciliationProjectionOutbox = pgTable(
  'reconciliation_projection_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    outputId: uuid('output_id')
      .notNull()
      .references(() => reconciliationOutputs.id, { onDelete: 'cascade' }),
    suggestionId: uuid('suggestion_id').references(() => agentSuggestions.id, {
      onDelete: 'cascade',
    }),
    suggestionItemId: uuid('suggestion_item_id').references(() => agentSuggestionItems.id, {
      onDelete: 'cascade',
    }),
    action: reconciliationProjectionOutboxAction('action').notNull(),
    status: reconciliationProjectionOutboxStatus('status').notNull().default('pending'),
    payload: jsonb('payload').notNull().default({}),
    dedupeKey: text('dedupe_key').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reconciliation_projection_outbox_team_dedupe_unq').on(
      table.teamId,
      table.dedupeKey,
    ),
    index('reconciliation_projection_outbox_team_status_idx').on(
      table.teamId,
      table.status,
      table.createdAt,
    ),
    index('reconciliation_projection_outbox_team_output_idx').on(table.teamId, table.outputId),
    index('reconciliation_projection_outbox_team_suggestion_item_idx').on(
      table.teamId,
      table.suggestionItemId,
    ),
  ],
);
