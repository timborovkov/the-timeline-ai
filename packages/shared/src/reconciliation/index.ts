import { createHash } from 'node:crypto';

export type {
  ReconciliationClusterDetail,
  ReconciliationClusterDetailEvidence,
  ReconciliationClusterDetailOutput,
  ReconciliationDashboardCount,
  ReconciliationDashboardCluster,
  ReconciliationDashboardInput,
  ReconciliationDashboardOutput,
  ReconciliationDashboardRun,
  ReconciliationDashboardSnapshot,
} from '#src/reconciliation/dashboard.js';
export {
  getReconciliationClusterDetail,
  getReconciliationDashboardSnapshot,
} from '#src/reconciliation/dashboard.js';
export type {
  ProductionSamplingBucket,
  ProductionSamplingEvalReport,
  ProductionSamplingEvalReportInput,
  ProductionSamplingFixtureCandidate,
  ProductionSamplingLatency,
  ProductionSamplingRunKind,
} from '#src/reconciliation/production-sampling.js';
export { buildProductionSamplingEvalReport } from '#src/reconciliation/production-sampling.js';

export type Visibility = 'team' | 'private' | 'specific_users';

export interface VisibilityEnvelope {
  visibility: Visibility;
  visibilityOwnerUserId?: string | null;
  visibilityUserIds?: string[] | null;
}

export interface SourceRef {
  source: string;
  rawEventId?: string | null;
  evidenceId?: string | null;
  associationId?: string | null;
  outputId?: string | null;
  sourcePayloadRef?: string | null;
}

export interface SourceRefValidationResult {
  ok: boolean;
  errors: string[];
}

export interface EvidenceDedupeInput {
  teamId: string;
  source: string;
  rawEventId: string;
  sourcePayloadDigest?: string | null;
  normalizerVersion: string;
}

export interface AssociationDedupeInput {
  teamId: string;
  clusterId: string;
  evidenceId: string;
  role: string;
  associationSource: string;
  associationPolicyVersion: string;
}

export interface OutputDedupeInput {
  teamId: string;
  clusterId?: string | null;
  targetKind: string;
  operation: string;
  targetId?: string | null;
  targetIdentity?: string | null;
  sourceRefs: SourceRef[];
  authorityPolicyVersion: string;
  plannerVersion: string;
}

export interface DeterministicEvalOutput {
  id: string;
  outputKind: string;
  targetKind: string;
  operation: string;
  artifactClusterKind?: ArtifactClusterKind;
  visibility: VisibilityEnvelope;
  visibilityFloor: VisibilityEnvelope;
  sourceRefs: SourceRef[];
}

export interface DeterministicEvalAssociation {
  id: string;
  role: string;
  artifactClusterKind?: ArtifactClusterKind;
  visibility: VisibilityEnvelope;
  visibilityFloor: VisibilityEnvelope;
  sourceRefs: SourceRef[];
}

export interface DeterministicEvalCase {
  name: string;
  scenarioFamily?: string;
  ingestionSurfaces: string[];
  associations?: DeterministicEvalAssociation[];
  outputs: DeterministicEvalOutput[];
  expected: {
    ingestionSurfaces: string[];
    associationRoleCounts?: Record<string, number>;
    outputKindCounts: Record<string, number>;
    forbiddenOutputKinds?: string[];
    requireValidSourceRefs: boolean;
    requireVisibilityFloors: boolean;
    requiredSourcePayloadSurfaces?: string[];
    requiredArtifactClusterKinds?: ArtifactClusterKind[];
  };
}

export interface DeterministicEvalResult {
  passed: boolean;
  failures: string[];
}

export interface ReconciliationEvalSuiteExpectation {
  ingestionSurfaces: string[];
  scenarioFamilies: string[];
}

export const reconciliationEvalIngestionSurfaces = [
  'web',
  'email',
  'slack',
  'telegram',
  'meeting',
  'document',
  'calendar',
  'system',
  'ingest_webhook',
  'github',
  'linear',
  'google_drive',
  'monday',
  'sentry',
] as const;

export const reconciliationEvalScenarioFamilies = [
  'customer_project',
  'incident_response',
  'decision_memory',
  'calendar_project',
  'generic_webhook',
] as const;

export type ReconciliationEvalIngestionSurface =
  (typeof reconciliationEvalIngestionSurfaces)[number];
export type ReconciliationEvalScenarioFamily = (typeof reconciliationEvalScenarioFamilies)[number];

const visibilityRank: Record<Visibility, number> = {
  team: 0,
  specific_users: 1,
  private: 2,
};

export const artifactClusterKinds = [
  'customer_project',
  'account',
  'incident',
  'deal',
  'document',
  'decision',
  'task',
  'meeting',
  'calendar_event',
  'provider_record',
  'topic',
  'person_context',
  'relationship_bundle',
  'system_workflow',
  'other',
] as const;

export type ArtifactClusterKind = (typeof artifactClusterKinds)[number];

export function visibilityAtOrBelowFloor(
  candidate: VisibilityEnvelope,
  floor: VisibilityEnvelope,
): boolean {
  if (visibilityRank[candidate.visibility] < visibilityRank[floor.visibility]) return false;
  if (floor.visibility === 'team') return true;

  if (floor.visibility === 'private') {
    return (
      candidate.visibility === 'private' &&
      Boolean(floor.visibilityOwnerUserId) &&
      candidate.visibilityOwnerUserId === floor.visibilityOwnerUserId
    );
  }

  if (candidate.visibility === 'private') {
    return Boolean(
      candidate.visibilityOwnerUserId &&
      normalizedUserIds(floor.visibilityUserIds).includes(candidate.visibilityOwnerUserId),
    );
  }

  return isSubset(
    normalizedUserIds(candidate.visibilityUserIds),
    normalizedUserIds(floor.visibilityUserIds),
  );
}

export function mostRestrictiveVisibility(envelopes: VisibilityEnvelope[]): Visibility {
  return envelopes.reduce<Visibility>(
    (current, envelope) =>
      visibilityRank[envelope.visibility] > visibilityRank[current] ? envelope.visibility : current,
    'team',
  );
}

export function validateSourceRefs(sourceRefs: SourceRef[]): SourceRefValidationResult {
  const errors: string[] = [];
  if (sourceRefs.length === 0) {
    errors.push('at least one source ref is required');
  }

  sourceRefs.forEach((ref, index) => {
    if (ref.source.trim().length === 0) {
      errors.push(`source_refs[${index}].source is required`);
    }
    if (
      !ref.rawEventId &&
      !ref.evidenceId &&
      !ref.associationId &&
      !ref.outputId &&
      !ref.sourcePayloadRef
    ) {
      errors.push(
        `source_refs[${index}] must cite raw event, evidence, association, output, or payload`,
      );
    }
  });

  return { ok: errors.length === 0, errors };
}

export function buildEvidenceDedupeKey(input: EvidenceDedupeInput): string {
  return reconciliationDedupeKey('evidence', input);
}

export function buildAssociationDedupeKey(input: AssociationDedupeInput): string {
  return reconciliationDedupeKey('association', input);
}

export function buildOutputDedupeKey(input: OutputDedupeInput): string {
  return reconciliationDedupeKey('output', {
    ...input,
    sourceRefs: input.sourceRefs.map(canonicalizeSourceRef).sort(compareStableJson),
  });
}

export function scoreDeterministicReconciliationCase(
  input: DeterministicEvalCase,
): DeterministicEvalResult {
  const failures: string[] = [];

  for (const surface of input.expected.ingestionSurfaces) {
    if (!input.ingestionSurfaces.includes(surface)) {
      failures.push(`${input.name}: missing ingestion surface ${surface}`);
    }
  }

  const actualCounts = input.outputs.reduce<Record<string, number>>((counts, output) => {
    counts[output.outputKind] = (counts[output.outputKind] ?? 0) + 1;
    return counts;
  }, {});

  for (const [kind, expectedCount] of Object.entries(input.expected.outputKindCounts)) {
    const actualCount = actualCounts[kind] ?? 0;
    if (actualCount !== expectedCount) {
      failures.push(
        `${input.name}: expected ${expectedCount} ${kind} output(s), got ${actualCount}`,
      );
    }
  }
  for (const kind of input.expected.forbiddenOutputKinds ?? []) {
    const actualCount = actualCounts[kind] ?? 0;
    if (actualCount > 0) {
      failures.push(`${input.name}: forbidden output kind ${kind} appeared ${actualCount} time(s)`);
    }
  }

  const actualAssociationCounts = (input.associations ?? []).reduce<Record<string, number>>(
    (counts, association) => {
      counts[association.role] = (counts[association.role] ?? 0) + 1;
      return counts;
    },
    {},
  );

  for (const [role, expectedCount] of Object.entries(input.expected.associationRoleCounts ?? {})) {
    const actualCount = actualAssociationCounts[role] ?? 0;
    if (actualCount !== expectedCount) {
      failures.push(
        `${input.name}: expected ${expectedCount} ${role} association(s), got ${actualCount}`,
      );
    }
  }

  if (input.expected.requireValidSourceRefs) {
    for (const output of input.outputs) {
      const validation = validateSourceRefs(output.sourceRefs);
      if (!validation.ok) {
        failures.push(`${input.name}:${output.id}: ${validation.errors.join('; ')}`);
      }
    }
    for (const association of input.associations ?? []) {
      const validation = validateSourceRefs(association.sourceRefs);
      if (!validation.ok) {
        failures.push(`${input.name}:${association.id}: ${validation.errors.join('; ')}`);
      }
    }
  }

  if (input.expected.requireVisibilityFloors) {
    for (const output of input.outputs) {
      if (!visibilityAtOrBelowFloor(output.visibility, output.visibilityFloor)) {
        failures.push(`${input.name}:${output.id}: output visibility exceeds visibility floor`);
      }
    }
    for (const association of input.associations ?? []) {
      if (!visibilityAtOrBelowFloor(association.visibility, association.visibilityFloor)) {
        failures.push(
          `${input.name}:${association.id}: association visibility exceeds visibility floor`,
        );
      }
    }
  }

  for (const surface of input.expected.requiredSourcePayloadSurfaces ?? []) {
    const hasPayloadRef = allEvalSourceRefs(input).some(
      (ref) => ref.source === surface && Boolean(ref.sourcePayloadRef),
    );
    if (!hasPayloadRef) {
      failures.push(`${input.name}: missing source payload ref for ${surface}`);
    }
  }

  const artifactClusterKinds = new Set(
    [
      ...input.outputs.map((output) => output.artifactClusterKind),
      ...(input.associations ?? []).map((association) => association.artifactClusterKind),
    ].filter((kind): kind is ArtifactClusterKind => Boolean(kind)),
  );
  for (const kind of input.expected.requiredArtifactClusterKinds ?? []) {
    if (!artifactClusterKinds.has(kind)) {
      failures.push(`${input.name}: missing artifact cluster kind ${kind}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

export function scoreReconciliationEvalSuite(
  cases: DeterministicEvalCase[],
  expected: ReconciliationEvalSuiteExpectation,
): DeterministicEvalResult {
  const failures: string[] = [];
  const coveredSurfaces = new Set(cases.flatMap((testCase) => testCase.ingestionSurfaces));
  const coveredFamilies = new Set(
    cases
      .map((testCase) => testCase.scenarioFamily)
      .filter((family): family is string => Boolean(family)),
  );

  for (const surface of expected.ingestionSurfaces) {
    if (!coveredSurfaces.has(surface)) {
      failures.push(`eval suite: missing ingestion surface ${surface}`);
    }
  }

  for (const family of expected.scenarioFamilies) {
    if (!coveredFamilies.has(family)) {
      failures.push(`eval suite: missing scenario family ${family}`);
    }
  }

  for (const testCase of cases) {
    const result = scoreDeterministicReconciliationCase(testCase);
    failures.push(...result.failures);
  }

  return { passed: failures.length === 0, failures };
}

export function reconciliationDedupeKey(kind: string, payload: unknown): string {
  const digest = createHash('sha256').update(stableJson(payload)).digest('hex').slice(0, 32);
  return `reconcile:${kind}:${digest}`;
}

function allEvalSourceRefs(input: DeterministicEvalCase): SourceRef[] {
  return [
    ...input.outputs.flatMap((output) => output.sourceRefs),
    ...(input.associations ?? []).flatMap((association) => association.sourceRefs),
  ];
}

function canonicalizeSourceRef(ref: SourceRef): SourceRef {
  return {
    source: ref.source,
    rawEventId: ref.rawEventId ?? null,
    evidenceId: ref.evidenceId ?? null,
    associationId: ref.associationId ?? null,
    outputId: ref.outputId ?? null,
    sourcePayloadRef: ref.sourcePayloadRef ?? null,
  };
}

function normalizedUserIds(ids: string[] | null | undefined): string[] {
  return [...new Set(ids ?? [])].sort();
}

function isSubset(candidate: string[], floor: string[]): boolean {
  if (candidate.length === 0) return floor.length === 0;
  return candidate.every((id) => floor.includes(id));
}

function compareStableJson(left: unknown, right: unknown): number {
  return stableJson(left).localeCompare(stableJson(right));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(',')}}`;
}
