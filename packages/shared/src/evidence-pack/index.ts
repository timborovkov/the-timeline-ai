import { createHash } from 'node:crypto';

import type { SourceRef, VisibilityEnvelope } from '#src/reconciliation/index.js';
import type { SearchEventArtifactClusterEvidence, TeamScope } from '#src/team-scope.js';

import { intersectVisibilityEnvelopes } from '#src/visibility.js';

export const EVIDENCE_PACK_VERSION = 'evidence-pack-v1';

export type EvidencePackPurpose = 'proposal' | 'answer';
export type EvidencePackRole = 'core' | 'supporting';
export type EvidencePackErrorCode =
  | 'missing_anchor'
  | 'inaccessible_anchor'
  | 'candidate_failure'
  | 'empty_audience';

export interface EvidencePackPolicy {
  version: string;
  purpose: EvidencePackPurpose;
  maxCoreEvents: number;
  maxSupportingEvents: number;
  maxSupportingEventsPerSurface: number;
  maxCandidates: number;
  maxEstimatedTokens: number;
  requireTeamVisibility: boolean;
}

export const EVIDENCE_PACK_POLICIES: Record<EvidencePackPurpose, EvidencePackPolicy> = {
  proposal: {
    version: 'proposal-v1',
    purpose: 'proposal',
    maxCoreEvents: 24,
    maxSupportingEvents: 8,
    maxSupportingEventsPerSurface: 4,
    maxCandidates: 500,
    maxEstimatedTokens: 6_000,
    requireTeamVisibility: true,
  },
  answer: {
    version: 'answer-v1',
    purpose: 'answer',
    maxCoreEvents: 24,
    maxSupportingEvents: 20,
    maxSupportingEventsPerSurface: 8,
    maxCandidates: 500,
    maxEstimatedTokens: 8_000,
    requireTeamVisibility: false,
  },
};

export interface EvidenceRelationshipSignal {
  kind: 'anchor' | 'conversation_core' | 'artifact_association' | 'semantic_retrieval';
  strength: 'hard' | 'human' | 'provider' | 'structured' | 'semantic';
  clusterId?: string;
  authoritative?: boolean;
}

export interface EvidencePackItem {
  rawEventId: string;
  surface: string;
  source: string;
  role: EvidencePackRole;
  contentText: string;
  occurredAt: Date;
  authorUserId: string | null;
  sourceMetadata: unknown;
  relationshipSignals: EvidenceRelationshipSignal[];
  sourceRefs: SourceRef[];
  rank: number;
  rankReasons: string[];
  visibility: VisibilityEnvelope;
  truncated: boolean;
  truncationReason: 'content_limit' | null;
}

export interface EvidencePackMetrics {
  candidateCount: number;
  selectedCount: number;
  surfaceCount: number;
  estimatedTokens: number;
  truncated: boolean;
  omissionReasons: Record<string, number>;
  buildDurationMs: number;
}

export interface EvidencePack {
  version: string;
  policyVersion: string;
  fingerprint: string;
  purpose: EvidencePackPurpose;
  audience: VisibilityEnvelope;
  items: EvidencePackItem[];
  metrics: EvidencePackMetrics;
}

export interface BuildEvidencePackInput {
  purpose: EvidencePackPurpose;
  anchorRawEventIds: string[];
  coreRawEventIds?: string[];
  semanticRawEventIds?: string[];
}

export class EvidencePackError extends Error {
  constructor(
    readonly code: EvidencePackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EvidencePackError';
  }
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(value: unknown, key: string): string | null {
  const field = metadataObject(value)[key];
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

export function evidenceSurface(source: string, sourceMetadata: unknown): string {
  if (source === 'ingest_webhook') {
    return metadataString(sourceMetadata, 'ingest_webhook_name') ?? 'Ingest webhook';
  }
  if (source === 'integration') {
    return metadataString(sourceMetadata, 'provider') ?? 'Integration';
  }
  const labels: Record<string, string> = {
    slack: 'Slack',
    telegram: 'Telegram',
    email: 'Email',
    meeting: 'Meetings',
    document: 'Documents',
    calendar: 'Calendar',
    web: 'Timeline',
    system: 'Timeline system',
  };
  return labels[source] ?? source;
}

function strengthRank(strength: string): number {
  return { human: 5, hard: 4, provider: 3, structured: 2, semantic: 0 }[strength] ?? 1;
}

function candidateSignal(
  evidence: SearchEventArtifactClusterEvidence,
  clusterId: string,
): EvidenceRelationshipSignal | null {
  if (
    !evidence.rawEventId ||
    evidence.strength === 'semantic' ||
    evidence.associationSource === 'model_candidate'
  ) {
    return null;
  }
  const strength = ['hard', 'human', 'provider', 'structured'].includes(evidence.strength)
    ? (evidence.strength as EvidenceRelationshipSignal['strength'])
    : 'structured';
  return {
    kind: 'artifact_association',
    strength,
    clusterId,
    authoritative: evidence.authoritative,
  };
}

function audienceFor(items: EvidencePackItem[]): VisibilityEnvelope {
  try {
    return intersectVisibilityEnvelopes(items.map((item) => item.visibility));
  } catch {
    throw new EvidencePackError('empty_audience', 'selected evidence has no common audience');
  }
}

function fingerprintFor(pack: Omit<EvidencePack, 'fingerprint'>): string {
  const stable = JSON.stringify({
    version: pack.version,
    policyVersion: pack.policyVersion,
    purpose: pack.purpose,
    audience: pack.audience,
    items: pack.items.map((item) => ({
      rawEventId: item.rawEventId,
      role: item.role,
      surface: item.surface,
      signals: item.relationshipSignals,
      truncated: item.truncated,
      truncationReason: item.truncationReason,
    })),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function buildEvidencePack(
  scope: TeamScope,
  input: BuildEvidencePackInput,
): Promise<EvidencePack> {
  const startedAt = performance.now();
  const policy = EVIDENCE_PACK_POLICIES[input.purpose];
  const anchors = [...new Set(input.anchorRawEventIds)];
  if (anchors.length === 0) {
    throw new EvidencePackError('missing_anchor', 'at least one evidence anchor is required');
  }
  const coreIds = [...new Set([...anchors, ...(input.coreRawEventIds ?? [])])].slice(
    0,
    policy.maxCoreEvents,
  );
  const hydratedCoreEvents = await scope.timeline.getEventsByIds(coreIds);
  if (hydratedCoreEvents.length !== coreIds.length) {
    throw new EvidencePackError(
      'inaccessible_anchor',
      'required evidence anchors are missing or inaccessible',
    );
  }
  if (
    policy.requireTeamVisibility &&
    hydratedCoreEvents.some((event) => event.visibility !== 'team')
  ) {
    throw new EvidencePackError(
      'inaccessible_anchor',
      'required evidence anchors are missing or inaccessible',
    );
  }
  const coreEventById = new Map(hydratedCoreEvents.map((event) => [event.id, event] as const));
  const coreEvents = coreIds.flatMap((id) => {
    const event = coreEventById.get(id);
    return event ? [event] : [];
  });

  const clusters = await scope.timeline.listEvidencePackArtifactClusters(
    coreIds,
    policy.maxCandidates,
  );
  const relatedSignals = new Map<string, EvidenceRelationshipSignal[]>();
  for (const cluster of Object.values(clusters)) {
    for (const evidence of cluster.relatedEvidence) {
      const signal = candidateSignal(evidence, cluster.id);
      if (!signal || coreIds.includes(evidence.rawEventId ?? '')) continue;
      const signals = relatedSignals.get(evidence.rawEventId ?? '') ?? [];
      signals.push(signal);
      relatedSignals.set(evidence.rawEventId ?? '', signals);
    }
  }
  const semanticSet = new Set(input.purpose === 'answer' ? (input.semanticRawEventIds ?? []) : []);
  for (const rawEventId of semanticSet) {
    if (coreIds.includes(rawEventId)) continue;
    const signals = relatedSignals.get(rawEventId) ?? [];
    signals.push({ kind: 'semantic_retrieval', strength: 'semantic' });
    relatedSignals.set(rawEventId, signals);
  }
  const supportingIds = [...relatedSignals.keys()].slice(0, policy.maxCandidates);
  const hydratedSupportingEvents = await scope.timeline.getEventsByIds(supportingIds);
  const supportingEvents = policy.requireTeamVisibility
    ? hydratedSupportingEvents.filter((event) => event.visibility === 'team')
    : hydratedSupportingEvents;
  const excludedByVisibility = hydratedSupportingEvents.length - supportingEvents.length;
  const coreSet = new Set(coreIds);
  const anchorSet = new Set(anchors);
  const maxCoreChars = Math.max(
    200,
    Math.floor((policy.maxEstimatedTokens * 4) / Math.max(coreEvents.length, 1)),
  );
  const events = [...coreEvents, ...supportingEvents].filter(
    (event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index,
  );

  const rawItems = events.map((event) => {
    const core = coreSet.has(event.id);
    const originalContent = event.contentText?.trim() ?? '';
    const maxChars = core ? Math.min(4_000, maxCoreChars) : 1_000;
    const contentText = originalContent.slice(0, maxChars);
    const relationshipSignals: EvidenceRelationshipSignal[] = core
      ? [
          anchorSet.has(event.id)
            ? { kind: 'anchor', strength: 'hard' }
            : { kind: 'conversation_core', strength: 'hard' },
          ...(semanticSet.has(event.id)
            ? [{ kind: 'semantic_retrieval' as const, strength: 'semantic' as const }]
            : []),
        ]
      : (relatedSignals.get(event.id) ?? []);
    const truncated = contentText.length < originalContent.length;
    return {
      rawEventId: event.id,
      surface: evidenceSurface(event.source, event.sourceMetadata),
      source: event.source,
      role: core ? ('core' as const) : ('supporting' as const),
      contentText,
      occurredAt: event.occurredAt,
      authorUserId: event.authorUserId,
      sourceMetadata: event.sourceMetadata,
      relationshipSignals,
      sourceRefs: [{ source: event.source, rawEventId: event.id }],
      rank: 0,
      rankReasons: core
        ? ['protected_core']
        : [
            'direct_artifact_relationship',
            ...(relationshipSignals.some((signal) => signal.authoritative)
              ? ['authoritative_source']
              : []),
          ],
      visibility: {
        visibility: event.visibility,
        visibilityOwnerUserId:
          event.visibilityOwnerUserId ??
          (event.visibility === 'private' ? event.authorUserId : null),
        visibilityUserIds: event.visibilityUserIds,
      },
      truncated,
      truncationReason: truncated ? 'content_limit' : null,
    } satisfies EvidencePackItem;
  });

  const coreItems = rawItems.filter((item) => item.role === 'core');
  const supporting = rawItems.filter((item) => item.role === 'supporting');
  const compareSupporting = (
    a: EvidencePackItem,
    b: EvidencePackItem,
    selectedSurfaces: ReadonlySet<string>,
  ) => {
    const aSignal = Math.max(
      ...a.relationshipSignals.map((signal) => strengthRank(signal.strength)),
    );
    const bSignal = Math.max(
      ...b.relationshipSignals.map((signal) => strengthRank(signal.strength)),
    );
    const authority =
      Number(b.relationshipSignals.some((signal) => signal.authoritative)) -
      Number(a.relationshipSignals.some((signal) => signal.authoritative));
    const diversity =
      Number(!selectedSurfaces.has(b.surface)) - Number(!selectedSurfaces.has(a.surface));
    const semantic =
      Number(b.relationshipSignals.some((signal) => signal.kind === 'semantic_retrieval')) -
      Number(a.relationshipSignals.some((signal) => signal.kind === 'semantic_retrieval'));
    return (
      bSignal - aSignal ||
      authority ||
      diversity ||
      semantic ||
      b.occurredAt.getTime() - a.occurredAt.getTime() ||
      a.rawEventId.localeCompare(b.rawEventId)
    );
  };
  const perSurface = new Map<string, number>();
  const selectedSupporting: EvidencePackItem[] = [];
  const remaining = [...supporting];
  while (remaining.length > 0 && selectedSupporting.length < policy.maxSupportingEvents) {
    const selectedSurfaces = new Set(perSurface.keys());
    remaining.sort((a, b) => compareSupporting(a, b, selectedSurfaces));
    const eligibleIndex = remaining.findIndex(
      (item) => (perSurface.get(item.surface) ?? 0) < policy.maxSupportingEventsPerSurface,
    );
    if (eligibleIndex < 0) break;
    const [item] = remaining.splice(eligibleIndex, 1);
    if (!item) break;
    const count = perSurface.get(item.surface) ?? 0;
    selectedSupporting.push({
      ...item,
      rankReasons: [
        ...item.rankReasons,
        ...(count === 0 ? ['source_diversity'] : []),
        ...(item.relationshipSignals.some((signal) => signal.kind === 'semantic_retrieval')
          ? ['semantic_relevance']
          : []),
      ],
    });
    perSurface.set(item.surface, count + 1);
  }

  const omissionReasons: Record<string, number> = {};
  if (excludedByVisibility > 0) omissionReasons.visibility = excludedByVisibility;
  const surfaceLimitCount = remaining.filter(
    (item) => (perSurface.get(item.surface) ?? 0) >= policy.maxSupportingEventsPerSurface,
  ).length;
  if (surfaceLimitCount > 0) omissionReasons.surface_limit = surfaceLimitCount;
  const supportingLimitCount = remaining.length - surfaceLimitCount;
  if (supportingLimitCount > 0) omissionReasons.supporting_limit = supportingLimitCount;
  const contentLimitCount = rawItems.filter((item) => item.truncated).length;
  if (contentLimitCount > 0) omissionReasons.content_limit = contentLimitCount;
  const selected: EvidencePackItem[] = [];
  let estimatedTokens = 0;
  for (const item of [...coreItems, ...selectedSupporting]) {
    const itemTokens = Math.ceil(item.contentText.length / 4);
    if (item.role === 'supporting' && estimatedTokens + itemTokens > policy.maxEstimatedTokens) {
      omissionReasons.token_budget = (omissionReasons.token_budget ?? 0) + 1;
      continue;
    }
    estimatedTokens += itemTokens;
    selected.push({ ...item, rank: selected.length + 1 });
  }
  const audience = audienceFor(selected);
  const metrics: EvidencePackMetrics = {
    candidateCount: rawItems.length,
    selectedCount: selected.length,
    surfaceCount: new Set(selected.map((item) => item.surface)).size,
    estimatedTokens,
    truncated: Object.keys(omissionReasons).length > 0 || selected.some((item) => item.truncated),
    omissionReasons,
    buildDurationMs: Math.max(0, performance.now() - startedAt),
  };
  const withoutFingerprint = {
    version: EVIDENCE_PACK_VERSION,
    policyVersion: policy.version,
    purpose: input.purpose,
    audience,
    items: selected,
    metrics,
  } satisfies Omit<EvidencePack, 'fingerprint'>;
  return { ...withoutFingerprint, fingerprint: fingerprintFor(withoutFingerprint) };
}
