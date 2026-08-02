const ARTIFACT_CLUSTER_KIND_LABELS: Record<string, string> = {
  customer_project: 'Customer project',
  account: 'Account',
  incident: 'Incident',
  deal: 'Deal',
  document: 'Document',
  decision: 'Decision',
  task: 'Task',
  meeting: 'Meeting',
  calendar_event: 'Calendar event',
  provider_record: 'Connected record',
  topic: 'Topic',
  person_context: 'Person context',
  relationship_bundle: 'Relationship',
  system_workflow: 'System workflow',
  other: 'Other work',
};

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  company: 'Company',
  project: 'Project',
  topic: 'Topic',
  other: 'Other item',
  deal: 'Deal',
  vendor: 'Vendor',
  incident: 'Incident',
  document: 'Document',
  decision: 'Decision',
  hiring_loop: 'Hiring loop',
  task: 'Task',
  follow_up: 'Follow-up',
  link: 'Link',
  monday_board: 'Monday board',
  sentry_project: 'Sentry project',
};

const EVIDENCE_ROLE_LABELS: Record<string, string> = {
  origin: 'Original record',
  update: 'Update',
  lifecycle_update: 'Status update',
  discussion: 'Discussion',
  blocker: 'Blocker',
  decision: 'Decision',
  related_context: 'Related context',
  contradiction: 'Conflicting evidence',
  correction: 'Correction',
  evidence_only: 'Supporting evidence',
};

const EVIDENCE_STRENGTH_LABELS: Record<string, string> = {
  hard: 'Direct source evidence',
  provider: 'Provider evidence',
  structured: 'Structured evidence',
  semantic: 'Related context',
  human: 'Human-confirmed evidence',
};

const OUTPUT_KIND_LABELS: Record<string, string> = {
  direct_write: 'Provider update',
  approval_bundle: 'Approval request',
  observed_association: 'Related evidence',
  no_action: 'No change',
  conflict: 'Conflicting evidence',
  eval_observation: 'Evaluation observation',
  agent_suggestion_projection: 'Suggestion projection',
};

const TARGET_KIND_LABELS: Record<string, string> = {
  object: 'workspace memory',
  task: 'task',
  calendar_event: 'calendar event',
  identity_facet: 'identity detail',
  object_note: 'workspace note',
  object_relationship: 'relationship',
  object_merge: 'duplicate records',
  board_membership: 'board membership',
  board_item_update: 'board item',
  cluster_identity: 'work identity',
  cluster_lifecycle: 'work status',
};

const OPERATION_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  archive_or_cancel: 'Archive or cancel',
  merge: 'Merge',
  link: 'Link',
  unlink: 'Remove link',
  supersede: 'Supersede',
  noop: 'No change',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

const CLUSTER_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  active: 'Active',
  blocked: 'Blocked',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

const OUTPUT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  applied: 'Applied',
  approval_created: 'Approval created',
  rejected: 'Rejected',
  superseded: 'Superseded',
  failed: 'Failed',
};

export function artifactClusterKindLabel(value: string): string {
  return ARTIFACT_CLUSTER_KIND_LABELS[value] ?? humanizeToken(value);
}

export function artifactTypeLabel(value: string): string {
  return ARTIFACT_TYPE_LABELS[value] ?? humanizeToken(value);
}

export function evidenceRoleLabel(value: string): string {
  return EVIDENCE_ROLE_LABELS[value] ?? humanizeToken(value);
}

export function evidenceStrengthLabel(value: string): string {
  return EVIDENCE_STRENGTH_LABELS[value] ?? humanizeToken(value);
}

export function outputKindLabel(value: string): string {
  return OUTPUT_KIND_LABELS[value] ?? humanizeToken(value);
}

export function outputActionLabel(input: { operation: string; targetKind: string }): string {
  const operation = OPERATION_LABELS[input.operation] ?? humanizeToken(input.operation);
  const target =
    TARGET_KIND_LABELS[input.targetKind] ?? humanizeToken(input.targetKind).toLowerCase();
  return `${operation} ${target}`;
}

export function confidenceLabel(value: string): string {
  return CONFIDENCE_LABELS[value] ?? `${humanizeToken(value)} confidence`;
}

export function clusterStatusLabel(value: string): string {
  return CLUSTER_STATUS_LABELS[value] ?? humanizeToken(value);
}

export function outputStatusLabel(value: string): string {
  return OUTPUT_STATUS_LABELS[value] ?? humanizeToken(value);
}

function humanizeToken(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : value;
}
