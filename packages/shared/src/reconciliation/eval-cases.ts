import type {
  DeterministicEvalCase,
  ReconciliationEvalIngestionSurface,
  ReconciliationEvalScenarioFamily,
} from '#src/reconciliation/index.js';

import {
  reconciliationEvalIngestionSurfaces,
  reconciliationEvalScenarioFamilies,
} from '#src/reconciliation/index.js';

const TEAM_VISIBILITY = { visibility: 'team' as const };
const PRIVATE_OWNER = {
  visibility: 'private' as const,
  visibilityOwnerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
const TEAM_VISIBLE = { visibility: TEAM_VISIBILITY, visibilityFloor: TEAM_VISIBILITY };
const PRIVATE_OWNER_VISIBLE = {
  visibility: PRIVATE_OWNER,
  visibilityFloor: PRIVATE_OWNER,
};

export const REQUIRED_RECONCILIATION_EVAL_SURFACES: ReconciliationEvalIngestionSurface[] = [
  ...reconciliationEvalIngestionSurfaces,
];

export const REQUIRED_RECONCILIATION_EVAL_SCENARIOS: ReconciliationEvalScenarioFamily[] = [
  ...reconciliationEvalScenarioFamilies,
];

export const RECONCILIATION_DETERMINISTIC_EVAL_CASES: DeterministicEvalCase[] = [
  {
    name: 'customer-project-email-monday-sentry',
    scenarioFamily: 'customer_project',
    ingestionSurfaces: ['email', 'monday', 'sentry'],
    associations: [
      {
        id: 'email-discussion-association-row',
        role: 'discussion',
        artifactClusterKind: 'customer_project',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-1',
            evidenceId: 'evidence-email-1',
            sourcePayloadRef: 's3://eval/reconciliation/email/raw-mime-1',
          },
        ],
      },
      {
        id: 'monday-lifecycle-association-row',
        role: 'lifecycle_update',
        artifactClusterKind: 'customer_project',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'monday',
            rawEventId: 'raw-monday-1',
            evidenceId: 'evidence-monday-1',
            sourcePayloadRef: 's3://eval/reconciliation/monday/item-456',
          },
        ],
      },
      {
        id: 'monday-provider-record-association-row',
        role: 'related_context',
        artifactClusterKind: 'provider_record',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'monday',
            rawEventId: 'raw-monday-1',
            evidenceId: 'evidence-monday-1',
            sourcePayloadRef: 's3://eval/reconciliation/monday/item-456',
          },
        ],
      },
    ],
    outputs: [
      {
        id: 'email-discussion-association',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'customer_project',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-1',
            evidenceId: 'evidence-email-1',
            sourcePayloadRef: 's3://eval/reconciliation/email/raw-mime-1',
          },
        ],
      },
      {
        id: 'sentry-lifecycle',
        outputKind: 'direct_write',
        targetKind: 'cluster_lifecycle',
        operation: 'update',
        artifactClusterKind: 'incident',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'sentry',
            rawEventId: 'raw-sentry-1',
            evidenceId: 'evidence-sentry-1',
            sourcePayloadRef: 's3://eval/reconciliation/sentry/issue-789',
          },
        ],
      },
      {
        id: 'monday-board-item-state',
        outputKind: 'direct_write',
        targetKind: 'board_item_update',
        operation: 'update',
        artifactClusterKind: 'customer_project',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'monday',
            rawEventId: 'raw-monday-1',
            evidenceId: 'evidence-monday-1',
            sourcePayloadRef: 's3://eval/reconciliation/monday/item-456',
          },
        ],
      },
      {
        id: 'monday-provider-record-linked',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'provider_record',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'monday',
            rawEventId: 'raw-monday-1',
            evidenceId: 'evidence-monday-1',
            sourcePayloadRef: 's3://eval/reconciliation/monday/item-456',
          },
        ],
      },
      {
        id: 'company-person-project-decision-bundle',
        outputKind: 'approval_bundle',
        targetKind: 'object_relationship',
        operation: 'create',
        artifactClusterKind: 'customer_project',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-1',
            evidenceId: 'evidence-email-1',
            sourcePayloadRef: 's3://eval/reconciliation/email/raw-mime-1',
          },
          {
            source: 'monday',
            rawEventId: 'raw-monday-1',
            evidenceId: 'evidence-monday-1',
            sourcePayloadRef: 's3://eval/reconciliation/monday/item-456',
          },
          {
            source: 'sentry',
            rawEventId: 'raw-sentry-1',
            evidenceId: 'evidence-sentry-1',
            sourcePayloadRef: 's3://eval/reconciliation/sentry/issue-789',
          },
        ],
      },
      {
        id: 'hard-anchor-cluster-conflict',
        outputKind: 'conflict',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'customer_project',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'monday',
            rawEventId: 'raw-monday-2',
            evidenceId: 'evidence-monday-2',
            sourcePayloadRef: 's3://eval/reconciliation/monday/item-456-conflict',
          },
        ],
      },
    ],
    expected: {
      ingestionSurfaces: ['email', 'monday', 'sentry'],
      associationRoleCounts: {
        discussion: 1,
        lifecycle_update: 1,
        related_context: 1,
      },
      outputKindCounts: {
        observed_association: 2,
        direct_write: 2,
        approval_bundle: 1,
        conflict: 1,
      },
      requireValidSourceRefs: true,
      requireVisibilityFloors: true,
      requiredSourcePayloadSurfaces: ['email', 'monday', 'sentry'],
      requiredArtifactClusterKinds: ['customer_project', 'provider_record', 'incident'],
    },
  },
  {
    name: 'sales-success-renewal-risk-email-slack-meeting-drive',
    scenarioFamily: 'sales_success',
    ingestionSurfaces: ['email', 'slack', 'meeting', 'google_drive'],
    associations: [
      {
        id: 'renewal-email-risk',
        role: 'customer_signal',
        artifactClusterKind: 'account',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-renewal-risk',
            evidenceId: 'evidence-email-renewal-risk',
            sourcePayloadRef: 's3://eval/reconciliation/email/renewal-risk',
          },
        ],
      },
      {
        id: 'renewal-meeting-commitment',
        role: 'commitment',
        artifactClusterKind: 'meeting',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'meeting',
            rawEventId: 'raw-meeting-renewal-review',
            evidenceId: 'evidence-meeting-renewal-review',
            sourcePayloadRef: 's3://eval/reconciliation/meeting/renewal-review-transcript',
          },
        ],
      },
    ],
    outputs: [
      {
        id: 'renewal-account-health-context',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'account',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-renewal-risk',
            evidenceId: 'evidence-email-renewal-risk',
            sourcePayloadRef: 's3://eval/reconciliation/email/renewal-risk',
          },
          {
            source: 'slack',
            rawEventId: 'raw-slack-renewal-escalation',
            evidenceId: 'evidence-slack-renewal-escalation',
            sourcePayloadRef: 's3://eval/reconciliation/slack/renewal-escalation-thread',
          },
        ],
      },
      {
        id: 'renewal-deal-document-context',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'document',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'google_drive',
            rawEventId: 'raw-drive-renewal-plan',
            evidenceId: 'evidence-drive-renewal-plan',
            sourcePayloadRef: 's3://eval/reconciliation/drive/renewal-plan',
          },
        ],
      },
      {
        id: 'renewal-deal-memory-approval',
        outputKind: 'approval_bundle',
        targetKind: 'object_relationship',
        operation: 'create',
        artifactClusterKind: 'deal',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-renewal-risk',
            evidenceId: 'evidence-email-renewal-risk',
            sourcePayloadRef: 's3://eval/reconciliation/email/renewal-risk',
          },
          {
            source: 'slack',
            rawEventId: 'raw-slack-renewal-escalation',
            evidenceId: 'evidence-slack-renewal-escalation',
            sourcePayloadRef: 's3://eval/reconciliation/slack/renewal-escalation-thread',
          },
          {
            source: 'meeting',
            rawEventId: 'raw-meeting-renewal-review',
            evidenceId: 'evidence-meeting-renewal-review',
            sourcePayloadRef: 's3://eval/reconciliation/meeting/renewal-review-transcript',
          },
          {
            source: 'google_drive',
            rawEventId: 'raw-drive-renewal-plan',
            evidenceId: 'evidence-drive-renewal-plan',
            sourcePayloadRef: 's3://eval/reconciliation/drive/renewal-plan',
          },
        ],
      },
      {
        id: 'renewal-follow-up-task-approval',
        outputKind: 'approval_bundle',
        targetKind: 'task',
        operation: 'create',
        artifactClusterKind: 'task',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'meeting',
            rawEventId: 'raw-meeting-renewal-review',
            evidenceId: 'evidence-meeting-renewal-review',
            sourcePayloadRef: 's3://eval/reconciliation/meeting/renewal-review-transcript',
          },
        ],
      },
    ],
    expected: {
      ingestionSurfaces: ['email', 'slack', 'meeting', 'google_drive'],
      associationRoleCounts: {
        customer_signal: 1,
        commitment: 1,
      },
      outputKindCounts: {
        observed_association: 2,
        approval_bundle: 2,
      },
      forbiddenOutputKinds: ['direct_write'],
      requireValidSourceRefs: true,
      requireVisibilityFloors: true,
      requiredSourcePayloadSurfaces: ['email', 'slack', 'meeting', 'google_drive'],
      requiredArtifactClusterKinds: ['account', 'meeting', 'document', 'deal', 'task'],
    },
  },
  {
    name: 'incident-response-sentry-github-slack-email',
    scenarioFamily: 'incident_response',
    ingestionSurfaces: ['sentry', 'github', 'slack', 'email'],
    associations: [
      {
        id: 'slack-war-room',
        role: 'discussion',
        artifactClusterKind: 'incident',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'slack',
            rawEventId: 'raw-slack-incident',
            evidenceId: 'evidence-slack-incident',
            sourcePayloadRef: 's3://eval/reconciliation/slack/war-room-thread',
          },
        ],
      },
      {
        id: 'email-customer-impact',
        role: 'related_context',
        artifactClusterKind: 'account',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-impact',
            evidenceId: 'evidence-email-impact',
            sourcePayloadRef: 's3://eval/reconciliation/email/customer-impact',
          },
        ],
      },
      {
        id: 'sentry-release-provider-record',
        role: 'release',
        artifactClusterKind: 'provider_record',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'sentry',
            rawEventId: 'raw-sentry-release',
            evidenceId: 'evidence-sentry-release',
            sourcePayloadRef: 's3://eval/reconciliation/sentry/release-2026-06-30',
          },
        ],
      },
    ],
    outputs: [
      {
        id: 'sentry-incident-resolved',
        outputKind: 'direct_write',
        targetKind: 'cluster_lifecycle',
        operation: 'update',
        artifactClusterKind: 'incident',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'sentry',
            rawEventId: 'raw-sentry-resolved',
            evidenceId: 'evidence-sentry-resolved',
            sourcePayloadRef: 's3://eval/reconciliation/sentry/issue-456',
          },
        ],
      },
      {
        id: 'github-pr-linked',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'task',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'github',
            rawEventId: 'raw-github-pr',
            evidenceId: 'evidence-github-pr',
            sourcePayloadRef: 's3://eval/reconciliation/github/pr-22',
          },
        ],
      },
      {
        id: 'sentry-release-linked',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'provider_record',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'sentry',
            rawEventId: 'raw-sentry-release',
            evidenceId: 'evidence-sentry-release',
            sourcePayloadRef: 's3://eval/reconciliation/sentry/release-2026-06-30',
          },
        ],
      },
      {
        id: 'customer-impact-approval',
        outputKind: 'approval_bundle',
        targetKind: 'object_note',
        operation: 'create',
        artifactClusterKind: 'account',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-email-impact',
            evidenceId: 'evidence-email-impact',
            sourcePayloadRef: 's3://eval/reconciliation/email/customer-impact',
          },
          {
            source: 'slack',
            rawEventId: 'raw-slack-incident',
            evidenceId: 'evidence-slack-incident',
            sourcePayloadRef: 's3://eval/reconciliation/slack/war-room-thread',
          },
        ],
      },
    ],
    expected: {
      ingestionSurfaces: ['sentry', 'github', 'slack', 'email'],
      associationRoleCounts: {
        discussion: 1,
        related_context: 1,
        release: 1,
      },
      outputKindCounts: {
        direct_write: 1,
        observed_association: 2,
        approval_bundle: 1,
      },
      requireValidSourceRefs: true,
      requireVisibilityFloors: true,
      requiredSourcePayloadSurfaces: ['sentry', 'github', 'slack', 'email'],
      requiredArtifactClusterKinds: ['incident', 'task', 'provider_record', 'account'],
    },
  },
  {
    name: 'decision-memory-meeting-telegram-document',
    scenarioFamily: 'decision_memory',
    ingestionSurfaces: ['meeting', 'telegram', 'document'],
    associations: [
      {
        id: 'meeting-decision-thread',
        role: 'decision',
        artifactClusterKind: 'decision',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'meeting',
            rawEventId: 'raw-meeting-final',
            evidenceId: 'evidence-meeting-final',
            sourcePayloadRef: 's3://eval/reconciliation/meeting/transcript-77',
          },
        ],
      },
    ],
    outputs: [
      {
        id: 'decision-object-approval',
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'create',
        artifactClusterKind: 'decision',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'meeting',
            rawEventId: 'raw-meeting-final',
            evidenceId: 'evidence-meeting-final',
            sourcePayloadRef: 's3://eval/reconciliation/meeting/transcript-77',
          },
          {
            source: 'telegram',
            rawEventId: 'raw-telegram-confirm',
            evidenceId: 'evidence-telegram-confirm',
            sourcePayloadRef: 's3://eval/reconciliation/telegram/message-884',
          },
          {
            source: 'document',
            rawEventId: 'raw-document-spec',
            evidenceId: 'evidence-document-spec',
            sourcePayloadRef: 's3://eval/reconciliation/document/spec-v3',
          },
        ],
      },
      {
        id: 'document-context-link',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'document',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'document',
            rawEventId: 'raw-document-spec',
            evidenceId: 'evidence-document-spec',
            sourcePayloadRef: 's3://eval/reconciliation/document/spec-v3',
          },
        ],
      },
    ],
    expected: {
      ingestionSurfaces: ['meeting', 'telegram', 'document'],
      associationRoleCounts: {
        decision: 1,
      },
      outputKindCounts: {
        approval_bundle: 1,
        observed_association: 1,
      },
      forbiddenOutputKinds: ['direct_write'],
      requireValidSourceRefs: true,
      requireVisibilityFloors: true,
      requiredSourcePayloadSurfaces: ['meeting', 'telegram', 'document'],
      requiredArtifactClusterKinds: ['decision', 'document'],
    },
  },
  {
    name: 'mcp-research-decision-context',
    scenarioFamily: 'decision_memory',
    ingestionSurfaces: ['mcp'],
    associations: [
      {
        id: 'mcp-research-context',
        role: 'related_context',
        artifactClusterKind: 'provider_record',
        ...PRIVATE_OWNER_VISIBLE,
        sourceRefs: [
          {
            source: 'mcp',
            rawEventId: 'raw-mcp-research',
            evidenceId: 'evidence-mcp-research',
            sourcePayloadRef: 'inline://timeline/mcp/research-server/tool-call-1',
          },
        ],
      },
    ],
    outputs: [
      {
        id: 'mcp-research-associated',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'provider_record',
        ...PRIVATE_OWNER_VISIBLE,
        sourceRefs: [
          {
            source: 'mcp',
            rawEventId: 'raw-mcp-research',
            evidenceId: 'evidence-mcp-research',
            sourcePayloadRef: 'inline://timeline/mcp/research-server/tool-call-1',
          },
        ],
      },
      {
        id: 'mcp-research-note-approval',
        outputKind: 'approval_bundle',
        targetKind: 'object_note',
        operation: 'create',
        artifactClusterKind: 'topic',
        ...PRIVATE_OWNER_VISIBLE,
        sourceRefs: [
          {
            source: 'mcp',
            rawEventId: 'raw-mcp-research',
            evidenceId: 'evidence-mcp-research',
            sourcePayloadRef: 'inline://timeline/mcp/research-server/tool-call-1',
          },
        ],
      },
    ],
    expected: {
      ingestionSurfaces: ['mcp'],
      associationRoleCounts: {
        related_context: 1,
      },
      outputKindCounts: {
        observed_association: 1,
        approval_bundle: 1,
      },
      forbiddenOutputKinds: ['direct_write'],
      requireValidSourceRefs: true,
      requireVisibilityFloors: true,
      requiredSourcePayloadSurfaces: ['mcp'],
      requiredArtifactClusterKinds: ['provider_record', 'topic'],
    },
  },
  {
    name: 'calendar-project-private-visibility',
    scenarioFamily: 'calendar_project',
    ingestionSurfaces: ['calendar'],
    associations: [
      {
        id: 'private-calendar-project-context',
        role: 'related_context',
        artifactClusterKind: 'calendar_event',
        ...PRIVATE_OWNER_VISIBLE,
        sourceRefs: [
          {
            source: 'calendar',
            rawEventId: 'raw-calendar-private',
            evidenceId: 'evidence-calendar-private',
            sourcePayloadRef: 's3://eval/reconciliation/calendar/private-review',
          },
        ],
      },
    ],
    outputs: [
      {
        id: 'private-calendar-approval',
        outputKind: 'approval_bundle',
        targetKind: 'task',
        operation: 'create',
        artifactClusterKind: 'task',
        ...PRIVATE_OWNER_VISIBLE,
        sourceRefs: [
          {
            source: 'calendar',
            rawEventId: 'raw-calendar-private',
            evidenceId: 'evidence-calendar-private',
            sourcePayloadRef: 's3://eval/reconciliation/calendar/private-review',
          },
        ],
      },
    ],
    expected: {
      ingestionSurfaces: ['calendar'],
      associationRoleCounts: {
        related_context: 1,
      },
      outputKindCounts: {
        approval_bundle: 1,
      },
      forbiddenOutputKinds: ['direct_write'],
      requireValidSourceRefs: true,
      requireVisibilityFloors: true,
      requiredSourcePayloadSurfaces: ['calendar'],
      requiredArtifactClusterKinds: ['calendar_event', 'task'],
    },
  },
  {
    name: 'generic-webhook-web-linear-drive',
    scenarioFamily: 'generic_webhook',
    ingestionSurfaces: ['ingest_webhook', 'web', 'linear', 'google_drive', 'system'],
    associations: [
      {
        id: 'web-note-context',
        role: 'related_context',
        artifactClusterKind: 'topic',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'web',
            rawEventId: 'raw-web-note',
            evidenceId: 'evidence-web-note',
            sourcePayloadRef: 'inline://timeline/web-note/raw-web-note',
          },
        ],
      },
      {
        id: 'system-approval-audit-context',
        role: 'audit_trail',
        artifactClusterKind: 'system_workflow',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'system',
            rawEventId: 'raw-system-approval-applied',
            evidenceId: 'evidence-system-approval-applied',
            sourcePayloadRef: 'inline://timeline/system/approval-applied',
          },
        ],
      },
      {
        id: 'linear-provider-record-context',
        role: 'related_context',
        artifactClusterKind: 'provider_record',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'linear',
            rawEventId: 'raw-linear-risk',
            evidenceId: 'evidence-linear-risk',
            sourcePayloadRef: 's3://eval/reconciliation/linear/issue-risk',
          },
        ],
      },
    ],
    outputs: [
      {
        id: 'webhook-provider-context',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'customer_project',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'ingest_webhook',
            rawEventId: 'raw-webhook-health',
            evidenceId: 'evidence-webhook-health',
            sourcePayloadRef: 's3://eval/reconciliation/webhook/customer-health',
          },
          {
            source: 'linear',
            rawEventId: 'raw-linear-risk',
            evidenceId: 'evidence-linear-risk',
            sourcePayloadRef: 's3://eval/reconciliation/linear/issue-risk',
          },
          {
            source: 'google_drive',
            rawEventId: 'raw-drive-plan',
            evidenceId: 'evidence-drive-plan',
            sourcePayloadRef: 's3://eval/reconciliation/drive/project-plan',
          },
          {
            source: 'web',
            rawEventId: 'raw-web-note',
            evidenceId: 'evidence-web-note',
            sourcePayloadRef: 'inline://timeline/web-note/raw-web-note',
          },
          {
            source: 'system',
            rawEventId: 'raw-system-approval-applied',
            evidenceId: 'evidence-system-approval-applied',
            sourcePayloadRef: 'inline://timeline/system/approval-applied',
          },
        ],
      },
      {
        id: 'linear-provider-record-linked',
        outputKind: 'observed_association',
        targetKind: 'cluster_identity',
        operation: 'link',
        artifactClusterKind: 'provider_record',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'linear',
            rawEventId: 'raw-linear-risk',
            evidenceId: 'evidence-linear-risk',
            sourcePayloadRef: 's3://eval/reconciliation/linear/issue-risk',
          },
        ],
      },
      {
        id: 'webhook-memory-approval',
        outputKind: 'approval_bundle',
        targetKind: 'object_note',
        operation: 'create',
        artifactClusterKind: 'account',
        ...TEAM_VISIBLE,
        sourceRefs: [
          {
            source: 'ingest_webhook',
            rawEventId: 'raw-webhook-health',
            evidenceId: 'evidence-webhook-health',
            sourcePayloadRef: 's3://eval/reconciliation/webhook/customer-health',
          },
        ],
      },
    ],
    expected: {
      ingestionSurfaces: ['ingest_webhook', 'web', 'linear', 'google_drive', 'system'],
      associationRoleCounts: {
        related_context: 2,
        audit_trail: 1,
      },
      outputKindCounts: {
        observed_association: 2,
        approval_bundle: 1,
      },
      requireValidSourceRefs: true,
      requireVisibilityFloors: true,
      requiredSourcePayloadSurfaces: ['ingest_webhook', 'web', 'linear', 'google_drive', 'system'],
      requiredArtifactClusterKinds: [
        'topic',
        'customer_project',
        'account',
        'provider_record',
        'system_workflow',
      ],
    },
  },
];
