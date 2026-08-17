import { createHash } from 'node:crypto';

import {
  type Db,
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  entityRelationships,
  factEntities,
  facts,
  objectChanges,
  objectNotes,
  objectSummaries,
  objectSummaryRuns,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
} from '@timeline/db';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { TeamScopeCore } from '#src/team-scope.js';

import { artifactRefCitation } from '#src/citation.js';
import { chatStructured } from '#src/llm/chat.js';
import { TIMELINE_MODELS, truncateTextToTokenBudget } from '#src/llm/models.js';
import * as queue from '#src/queue/queues.js';

const OBJECT_SUMMARY_PROMPT_VERSION = 'object-summary-v1';
const OBJECT_SUMMARY_AUTO_DELAY_MS = 2 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), id: z.string().min(1) }),
  z.object({ kind: z.literal('fact'), id: z.string().regex(UUID_RE) }),
  z.object({ kind: z.literal('timeline_event'), id: z.string().regex(UUID_RE) }),
  z.object({ kind: z.literal('object_note'), id: z.string().regex(UUID_RE) }),
  z.object({ kind: z.literal('relationship'), id: z.string().regex(UUID_RE) }),
  z.object({ kind: z.literal('task'), id: z.string().regex(UUID_RE) }),
  z.object({ kind: z.literal('object_change'), id: z.string().regex(UUID_RE) }),
]);

const claimSchema = z.object({
  label: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(500),
  sourceRefs: z.array(sourceRefSchema).min(1).max(6),
});

const generatedObjectSummarySchema = z.object({
  overview: z.string().trim().min(1).max(1200),
  overviewSourceRefs: z.array(sourceRefSchema).min(1).max(8),
  currentState: z.array(claimSchema).max(6).default([]),
  openQuestions: z.array(claimSchema).max(4).default([]),
  conflicts: z.array(claimSchema).max(4).default([]),
});

export type ObjectSummarySourceRef = z.infer<typeof sourceRefSchema>;
type GeneratedObjectSummary = z.infer<typeof generatedObjectSummarySchema>;

export interface ObjectSummaryView {
  status: 'missing' | 'pending' | 'ready' | 'stale' | 'failed';
  summary: GeneratedObjectSummary | null;
  plainText: string;
  sourceRefs: ObjectSummarySourceRef[];
  sourceCounts: ObjectSummarySourceCounts;
  generatedAt: Date | null;
  staleAt: Date | null;
  lastAttemptedAt: Date | null;
  lastErrorCode: string | null;
  canGenerate: boolean;
  cannotGenerateReason: string | null;
}

export interface ObjectSummarySourceCounts {
  fields: number;
  facts: number;
  events: number;
  notes: number;
  relationships: number;
  tasks: number;
  changes: number;
}

export interface ObjectSummarySourceSnapshot {
  sourceCounts: ObjectSummarySourceCounts;
  meaningfulFields: number;
}

export function objectSummarySourceSnapshot(
  object: {
    stage: string | null;
    priority: number | null;
    dueAt: Date | null;
  },
  sourceCounts: Omit<ObjectSummarySourceCounts, 'fields'>,
): ObjectSummarySourceSnapshot {
  return {
    sourceCounts: {
      fields:
        2 + (object.stage ? 1 : 0) + (object.priority !== null ? 1 : 0) + (object.dueAt ? 1 : 0),
      ...sourceCounts,
    },
    meaningfulFields:
      (object.stage ? 1 : 0) + (object.priority !== null ? 1 : 0) + (object.dueAt ? 1 : 0),
  };
}

interface SummaryPacketSource {
  ref: ObjectSummarySourceRef;
  label: string;
  text: string;
  occurredAt: string | null;
  confidence?: number | null;
}

interface ObjectSummaryPacket {
  object: {
    id: string;
    type: string;
    canonicalName: string;
    aliases: string[];
    status: string;
    stage: string | null;
    priority: number | null;
    dueAt: string | null;
    archivedAt: string | null;
  };
  sources: SummaryPacketSource[];
  sourceCounts: ObjectSummarySourceCounts;
  canGenerate: boolean;
  cannotGenerateReason: string | null;
  inputFingerprint: string;
}

interface GenerateDeps {
  chatStructured?: typeof chatStructured;
  enqueueObjectEmbedJob?: typeof queue.enqueueObjectEmbedJob;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      const record = val as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return val;
  });
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function textFromJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function objectSummaryFromJson(value: unknown): GeneratedObjectSummary | null {
  const parsed = generatedObjectSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function refsFromJson(value: unknown): ObjectSummarySourceRef[] {
  const parsed = z.array(sourceRefSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function countsFromJson(value: unknown): ObjectSummarySourceCounts {
  const parsed = z
    .object({
      fields: z.number().int().nonnegative().default(0),
      facts: z.number().int().nonnegative().default(0),
      events: z.number().int().nonnegative().default(0),
      notes: z.number().int().nonnegative().default(0),
      relationships: z.number().int().nonnegative().default(0),
      tasks: z.number().int().nonnegative().default(0),
      changes: z.number().int().nonnegative().default(0),
    })
    .safeParse(value);
  return parsed.success
    ? parsed.data
    : { fields: 0, facts: 0, events: 0, notes: 0, relationships: 0, tasks: 0, changes: 0 };
}

function uniqueRefs(refs: ObjectSummarySourceRef[]): ObjectSummarySourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summaryPlainText(summary: GeneratedObjectSummary): string {
  return [
    summary.overview,
    ...summary.currentState.map((item) => `${item.label}: ${item.text}`),
    ...summary.openQuestions.map((item) => `${item.label}: ${item.text}`),
    ...summary.conflicts.map((item) => `${item.label}: ${item.text}`),
  ]
    .filter(Boolean)
    .join('\n');
}

function allSummaryRefs(summary: GeneratedObjectSummary): ObjectSummarySourceRef[] {
  return uniqueRefs([
    ...summary.overviewSourceRefs,
    ...summary.currentState.flatMap((item) => item.sourceRefs),
    ...summary.openQuestions.flatMap((item) => item.sourceRefs),
    ...summary.conflicts.flatMap((item) => item.sourceRefs),
  ]);
}

function aliases(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function sourceKey(ref: ObjectSummarySourceRef): string {
  return `${ref.kind}:${ref.id}`;
}

function sufficiency(counts: ObjectSummarySourceCounts, meaningfulFields: number) {
  if (counts.facts >= 2) return { canGenerate: true, reason: null };
  if (counts.facts >= 1 && meaningfulFields >= 1) return { canGenerate: true, reason: null };
  // One cited source event is enough. GitHub skip-extract objects have no facts;
  // accepted create-evidence is the "why this exists" packet for those hubs.
  if (counts.events >= 1) return { canGenerate: true, reason: null };
  if (counts.notes >= 1) return { canGenerate: true, reason: null };
  if (counts.tasks >= 1 && counts.facts + counts.notes + counts.relationships >= 1) {
    return { canGenerate: true, reason: null };
  }
  if (counts.relationships + counts.changes >= 2) return { canGenerate: true, reason: null };
  return { canGenerate: false, reason: 'not_enough_object_memory' };
}

async function buildObjectSummaryPacket(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
): Promise<ObjectSummaryPacket | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(entityId)) return null;

  const objectRows = await db
    .select()
    .from(entities)
    .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, entityId)))
    .limit(1);
  const object = objectRows[0];
  if (!object || object.mergedIntoId) return null;

  const fieldSources: SummaryPacketSource[] = [
    { ref: { kind: 'field', id: 'type' }, label: 'Type', text: object.type, occurredAt: null },
    {
      ref: { kind: 'field', id: 'status' },
      label: 'Status',
      text: object.status,
      occurredAt: object.updatedAt.toISOString(),
    },
    ...(object.stage
      ? [
          {
            ref: { kind: 'field' as const, id: 'stage' },
            label: 'Stage',
            text: object.stage,
            occurredAt: object.updatedAt.toISOString(),
          },
        ]
      : []),
    ...(object.priority !== null
      ? [
          {
            ref: { kind: 'field' as const, id: 'priority' },
            label: 'Priority',
            text: String(object.priority),
            occurredAt: object.updatedAt.toISOString(),
          },
        ]
      : []),
    ...(object.dueAt
      ? [
          {
            ref: { kind: 'field' as const, id: 'dueAt' },
            label: 'Due date',
            text: object.dueAt.toISOString(),
            occurredAt: object.updatedAt.toISOString(),
          },
        ]
      : []),
  ];

  const [
    factRows,
    noteRows,
    relationshipOutRows,
    relationshipInRows,
    taskRows,
    changeRows,
    associationRows,
    createEvidenceRows,
  ] = await Promise.all([
    db
      .select({
        id: facts.id,
        statement: facts.statement,
        confidence: facts.confidence,
        rawEventId: facts.rawEventId,
        extractedAt: facts.extractedAt,
        occurredAt: rawEvents.occurredAt,
      })
      .from(facts)
      .innerJoin(factEntities, eq(factEntities.factId, facts.id))
      .innerJoin(rawEvents, eq(rawEvents.id, facts.rawEventId))
      .where(
        and(
          eq(facts.teamId, scope.teamId),
          eq(factEntities.entityId, entityId),
          eq(rawEvents.teamId, scope.teamId),
          eq(rawEvents.visibility, 'team'),
          sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        ),
      )
      .orderBy(desc(rawEvents.occurredAt), desc(facts.extractedAt))
      .limit(24),
    db
      .select({
        id: objectNotes.id,
        body: objectNotes.body,
        updatedAt: objectNotes.updatedAt,
      })
      .from(objectNotes)
      .where(
        and(
          eq(objectNotes.teamId, scope.teamId),
          eq(objectNotes.entityId, entityId),
          isNull(objectNotes.deletedAt),
        ),
      )
      .orderBy(desc(objectNotes.updatedAt), desc(objectNotes.id))
      .limit(8),
    db
      .select({
        id: entityRelationships.id,
        kind: entityRelationships.kind,
        createdAt: entityRelationships.createdAt,
        otherName: entities.canonicalName,
        otherType: entities.type,
      })
      .from(entityRelationships)
      .innerJoin(entities, eq(entities.id, entityRelationships.toEntityId))
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.fromEntityId, entityId),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .orderBy(desc(entityRelationships.createdAt))
      .limit(8),
    db
      .select({
        id: entityRelationships.id,
        kind: entityRelationships.kind,
        createdAt: entityRelationships.createdAt,
        otherName: entities.canonicalName,
        otherType: entities.type,
      })
      .from(entityRelationships)
      .innerJoin(entities, eq(entities.id, entityRelationships.fromEntityId))
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, entityId),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .orderBy(desc(entityRelationships.createdAt))
      .limit(8),
    db
      .select({
        id: entities.id,
        canonicalName: entities.canonicalName,
        status: entities.status,
        dueAt: entities.dueAt,
        updatedAt: entities.updatedAt,
      })
      .from(entityRelationships)
      .innerJoin(entities, eq(entities.id, entityRelationships.fromEntityId))
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, entityId),
          eq(entityRelationships.kind, 'child'),
          eq(entities.teamId, scope.teamId),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
          ne(entities.status, 'done'),
          ne(entities.status, 'cancelled'),
        ),
      )
      .orderBy(desc(entities.updatedAt), desc(entities.id))
      .limit(8),
    db
      .select({
        id: objectChanges.id,
        field: objectChanges.field,
        newValue: objectChanges.newValue,
        note: objectChanges.note,
        changedAt: objectChanges.changedAt,
      })
      .from(objectChanges)
      .where(
        and(
          eq(objectChanges.teamId, scope.teamId),
          eq(objectChanges.entityId, entityId),
          isNull(objectChanges.sourceEventId),
        ),
      )
      .orderBy(desc(objectChanges.changedAt), desc(objectChanges.id))
      .limit(8),
    db
      .select({
        associationId: artifactEvidenceAssociations.id,
        role: artifactEvidenceAssociations.role,
        rawEventId: sql<string>`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId})`,
        title: reconciliationEvidence.title,
        summary: reconciliationEvidence.summary,
        occurredAt: reconciliationEvidence.occurredAt,
        source: reconciliationEvidence.source,
      })
      .from(artifactClusters)
      .innerJoin(
        artifactEvidenceAssociations,
        eq(artifactEvidenceAssociations.clusterId, artifactClusters.id),
      )
      .innerJoin(
        reconciliationEvidence,
        eq(reconciliationEvidence.id, artifactEvidenceAssociations.evidenceId),
      )
      .innerJoin(
        rawEvents,
        eq(
          rawEvents.id,
          sql`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId})`,
        ),
      )
      .where(
        and(
          eq(artifactClusters.teamId, scope.teamId),
          eq(artifactClusters.canonicalEntityId, entityId),
          eq(artifactEvidenceAssociations.teamId, scope.teamId),
          eq(artifactEvidenceAssociations.visibility, 'team'),
          eq(artifactEvidenceAssociations.visibilityFloor, 'team'),
          eq(reconciliationEvidence.teamId, scope.teamId),
          eq(rawEvents.teamId, scope.teamId),
          eq(rawEvents.visibility, 'team'),
          sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        ),
      )
      .orderBy(desc(reconciliationEvidence.occurredAt), desc(artifactEvidenceAssociations.id))
      .limit(8),
    db
      .select({
        rawEventId: rawEvents.id,
        contentText: rawEvents.contentText,
        occurredAt: rawEvents.occurredAt,
        source: rawEvents.source,
        quote: agentSuggestionEvidence.quote,
      })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .innerJoin(
        agentSuggestionEvidence,
        eq(agentSuggestionEvidence.suggestionId, agentSuggestions.id),
      )
      .innerJoin(rawEvents, eq(rawEvents.id, agentSuggestionEvidence.rawEventId))
      .where(
        and(
          eq(agentSuggestions.teamId, scope.teamId),
          eq(agentSuggestionItems.teamId, scope.teamId),
          eq(agentSuggestionEvidence.teamId, scope.teamId),
          eq(rawEvents.teamId, scope.teamId),
          eq(agentSuggestionItems.status, 'accepted'),
          eq(agentSuggestionItems.operation, 'create'),
          eq(agentSuggestions.visibility, 'team'),
          eq(rawEvents.visibility, 'team'),
          sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
          or(
            eq(agentSuggestionItems.targetId, entityId),
            eq(agentSuggestionItems.resultId, entityId),
          ),
        ),
      )
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(8),
  ]);

  const factSources: SummaryPacketSource[] = factRows.map((fact) => ({
    ref: { kind: 'fact', id: fact.id },
    label: `Fact ${fact.confidence.toFixed(2)}`,
    text: fact.statement,
    occurredAt: fact.occurredAt.toISOString(),
    confidence: fact.confidence,
  }));
  const eventSources: SummaryPacketSource[] = uniqueRefs([
    ...factRows.map((fact) => ({ kind: 'timeline_event' as const, id: fact.rawEventId })),
    ...associationRows.map((association) => ({
      kind: 'timeline_event' as const,
      id: association.rawEventId,
    })),
    ...createEvidenceRows.map((row) => ({
      kind: 'timeline_event' as const,
      id: row.rawEventId,
    })),
  ]).map((ref) => {
    const fact = factRows.find((row) => row.rawEventId === ref.id);
    const association = associationRows.find((row) => row.rawEventId === ref.id);
    const created = createEvidenceRows.find((row) => row.rawEventId === ref.id);
    return {
      ref,
      label: association
        ? `Reconciliation ${association.role}`
        : created
          ? 'Creation evidence'
          : 'Source event',
      text:
        created?.quote ||
        created?.contentText ||
        association?.summary ??
        association?.title ??
        fact?.statement ??
        `${association?.source ?? created?.source ?? 'source'} event`,
      occurredAt:
        created?.occurredAt.toISOString() ??
        association?.occurredAt.toISOString() ??
        fact?.occurredAt.toISOString() ??
        null,
      confidence: fact?.confidence ?? null,
    };
  });
  const noteSources: SummaryPacketSource[] = noteRows
    .filter((note) => note.body.trim().length >= 40)
    .map((note) => ({
      ref: { kind: 'object_note', id: note.id },
      label: 'Note',
      text: note.body,
      occurredAt: note.updatedAt.toISOString(),
    }));
  const relationshipSources: SummaryPacketSource[] = [
    ...relationshipOutRows,
    ...relationshipInRows,
  ].map((relationship) => ({
    ref: { kind: 'relationship', id: relationship.id },
    label: `Relationship ${relationship.kind}`,
    text: `${relationship.kind}: ${relationship.otherName} (${relationship.otherType})`,
    occurredAt: relationship.createdAt.toISOString(),
  }));
  const taskSources: SummaryPacketSource[] = taskRows.map((task) => ({
    ref: { kind: 'task', id: task.id },
    label: 'Open task',
    text: [task.canonicalName, task.status, task.dueAt ? `due ${task.dueAt.toISOString()}` : null]
      .filter(Boolean)
      .join(' · '),
    occurredAt: task.updatedAt.toISOString(),
  }));
  const changeSources: SummaryPacketSource[] = changeRows.map((change) => ({
    ref: { kind: 'object_change', id: change.id },
    label: `Recent change ${change.field}`,
    text: change.note ?? `${change.field}: ${textFromJson(change.newValue)}`,
    occurredAt: change.changedAt.toISOString(),
  }));

  const snapshot = objectSummarySourceSnapshot(object, {
    facts: factSources.length,
    events: eventSources.length,
    notes: noteSources.length,
    relationships: relationshipSources.length,
    tasks: taskSources.length,
    changes: changeSources.length,
  });
  const enough = sufficiency(snapshot.sourceCounts, snapshot.meaningfulFields);
  const packet = {
    object: {
      id: object.id,
      type: object.type,
      canonicalName: object.canonicalName,
      aliases: aliases(object.aliases),
      status: object.status,
      stage: object.stage,
      priority: object.priority,
      dueAt: object.dueAt?.toISOString() ?? null,
      archivedAt: object.archivedAt?.toISOString() ?? null,
    },
    sources: [
      ...fieldSources,
      ...taskSources,
      ...relationshipSources,
      ...factSources,
      ...eventSources,
      ...noteSources,
      ...changeSources,
    ],
    sourceCounts: snapshot.sourceCounts,
    canGenerate: enough.canGenerate,
    cannotGenerateReason: enough.reason,
  };
  return { ...packet, inputFingerprint: fingerprint(packet) };
}

function promptForPacket(packet: ObjectSummaryPacket): string {
  return truncateTextToTokenBudget(
    JSON.stringify(
      {
        instructions: [
          'Write a compact operational object summary.',
          'Infer current state from newer confirmed sources; older tentative facts can be superseded.',
          'If creation evidence is present, say what the source wrote, which system or repo, and when.',
          'Do not invent names, dates, owners, recommendations, or source ids.',
          'Use currentState for concrete source-backed dates, next steps, blockers, owners, or risks.',
          'Use conflicts only when sources materially disagree and recency does not resolve it.',
          'Every overview and item sourceRefs entry must use ids from sources.',
        ],
        object: packet.object,
        sources: packet.sources,
      },
      null,
      2,
    ),
    24_000,
  );
}

function validateSummaryRefs(summary: GeneratedObjectSummary, packet: ObjectSummaryPacket): void {
  const allowed = new Set(packet.sources.map((source) => sourceKey(source.ref)));
  const refs = allSummaryRefs(summary);
  for (const ref of refs) {
    if (!allowed.has(sourceKey(ref))) {
      throw new Error(`invalid_source_ref:${sourceKey(ref)}`);
    }
  }
}

function objectSummaryFailureMessages(err: unknown): string[] {
  const messages = [err instanceof Error ? err.message : String(err)];
  if (
    err &&
    typeof err === 'object' &&
    'causeMessage' in err &&
    typeof err.causeMessage === 'string'
  ) {
    messages.push(err.causeMessage);
  }
  return messages.map((message) => message.toLowerCase());
}

function retryableObjectSummaryMessage(message: string): boolean {
  return (
    /\b(?:http(?: status)?|status(?: code)?|response status)\s*[:=]?\s*(?:429|5\d\d)\b/.test(
      message,
    ) ||
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('unavailable') ||
    message.includes('network') ||
    message.includes('econn')
  );
}

function objectSummaryFailureCauses(err: unknown): unknown[] {
  const nestedCause =
    err instanceof Error && 'cause' in err && err.cause !== undefined
      ? objectSummaryFailureCauses(err.cause)
      : [];
  if (err instanceof AggregateError) {
    return [err, ...err.errors.flatMap(objectSummaryFailureCauses), ...nestedCause];
  }
  return [err, ...nestedCause];
}

function isRetryableObjectSummaryError(err: unknown): boolean {
  const causes = objectSummaryFailureCauses(err);
  return causes.some((cause) => {
    if (objectSummaryFailureMessages(cause).some(retryableObjectSummaryMessage)) return true;
    if (!cause || typeof cause !== 'object') return false;
    const row = cause as {
      isRetryable?: unknown;
      name?: unknown;
      responseStatus?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const status = row.statusCode ?? row.status ?? row.responseStatus;
    return (
      row.isRetryable === true ||
      (typeof status === 'number' && (status === 408 || status === 429 || status >= 500)) ||
      row.name === 'AbortError' ||
      row.name === 'TimeoutError'
    );
  });
}

async function upsertPendingSummary(db: Db, scope: TeamScopeCore, entityId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(objectSummaries)
    .values({
      teamId: scope.teamId,
      entityId,
      status: 'pending',
      lastAttemptedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [objectSummaries.teamId, objectSummaries.entityId],
      set: {
        status: 'pending',
        lastAttemptedAt: now,
        updatedAt: now,
        attemptCount: sql`${objectSummaries.attemptCount} + 1`,
      },
    });
}

export async function getObjectSummary(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
): Promise<ObjectSummaryView | null> {
  const [packet, rows] = await Promise.all([
    buildObjectSummaryPacket(db, scope, entityId),
    db
      .select()
      .from(objectSummaries)
      .where(and(eq(objectSummaries.teamId, scope.teamId), eq(objectSummaries.entityId, entityId)))
      .limit(1),
  ]);
  if (!packet) return null;
  const row = rows[0];
  return {
    status: row?.status ?? 'missing',
    summary: row ? objectSummaryFromJson(row.summary) : null,
    plainText: row?.plainText ?? '',
    sourceRefs: row ? refsFromJson(row.sourceRefs) : [],
    sourceCounts: row ? countsFromJson(row.sourceCounts) : packet.sourceCounts,
    generatedAt: row?.generatedAt ?? null,
    staleAt: row?.staleAt ?? null,
    lastAttemptedAt: row?.lastAttemptedAt ?? null,
    lastErrorCode: row?.lastErrorCode ?? null,
    canGenerate: packet.canGenerate,
    cannotGenerateReason: packet.cannotGenerateReason,
  };
}

export async function getObjectSummaryFromSnapshot(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  snapshot: ObjectSummarySourceSnapshot,
): Promise<ObjectSummaryView | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(entityId)) return null;
  const rows = await db
    .select()
    .from(objectSummaries)
    .where(and(eq(objectSummaries.teamId, scope.teamId), eq(objectSummaries.entityId, entityId)))
    .limit(1);
  const row = rows[0];
  const enough = sufficiency(snapshot.sourceCounts, snapshot.meaningfulFields);
  return {
    status: row?.status ?? 'missing',
    summary: row ? objectSummaryFromJson(row.summary) : null,
    plainText: row?.plainText ?? '',
    sourceRefs: row ? refsFromJson(row.sourceRefs) : [],
    sourceCounts: row ? countsFromJson(row.sourceCounts) : snapshot.sourceCounts,
    generatedAt: row?.generatedAt ?? null,
    staleAt: row?.staleAt ?? null,
    lastAttemptedAt: row?.lastAttemptedAt ?? null,
    lastErrorCode: row?.lastErrorCode ?? null,
    canGenerate: enough.canGenerate,
    cannotGenerateReason: enough.reason,
  };
}

export async function enqueueObjectSummaryRefresh(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  opts: { trigger?: 'manual' | 'auto' | 'retry'; delayMs?: number } = {},
): Promise<{
  enqueued: boolean;
  jobId: string | null;
  canGenerate: boolean;
  reason: string | null;
}> {
  const packet = await buildObjectSummaryPacket(db, scope, entityId);
  if (!packet) return { enqueued: false, jobId: null, canGenerate: false, reason: 'not_found' };
  if (!packet.canGenerate) {
    return {
      enqueued: false,
      jobId: null,
      canGenerate: false,
      reason: packet.cannotGenerateReason,
    };
  }
  const result = await queue.enqueueObjectSummaryJob(
    { teamId: scope.teamId, objectId: entityId, trigger: opts.trigger ?? 'auto' },
    opts.delayMs === undefined ? {} : { delayMs: opts.delayMs },
  );
  await upsertPendingSummary(db, scope, entityId);
  return { ...result, canGenerate: true, reason: null };
}

export async function fireAndForgetObjectSummaryRefresh(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  context: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  await Promise.all([
    db
      .update(objectSummaries)
      .set({
        status: sql`CASE WHEN COALESCE(${objectSummaries.plainText}, '') <> '' THEN 'stale'::object_summary_status ELSE 'pending'::object_summary_status END`,
        staleAt: now,
        updatedAt: now,
      })
      .where(and(eq(objectSummaries.teamId, scope.teamId), eq(objectSummaries.entityId, entityId)))
      .catch((err: unknown) => {
        console.error('failed to mark object summary stale', { err, ...context });
      }),
    db
      .insert(objectSummaries)
      .values({
        teamId: scope.teamId,
        entityId,
        status: 'pending',
        lastAttemptedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [objectSummaries.teamId, objectSummaries.entityId],
      })
      .catch((err: unknown) => {
        console.error('failed to create pending object summary', { err, ...context });
      }),
    queue
      .enqueueObjectSummaryJob(
        { teamId: scope.teamId, objectId: entityId, trigger: 'auto' },
        { delayMs: OBJECT_SUMMARY_AUTO_DELAY_MS },
      )
      .catch((err: unknown) => {
        console.error('failed to enqueue object summary refresh', { err, ...context });
      }),
  ]);
}

async function objectIdsTouchedByRawEvent(
  db: Db,
  teamId: string,
  rawEventId: string,
): Promise<string[]> {
  const [factRows, outputRows, associationRows] = await Promise.all([
    db
      .select({ entityId: factEntities.entityId })
      .from(factEntities)
      .innerJoin(facts, eq(facts.id, factEntities.factId))
      .where(and(eq(facts.teamId, teamId), eq(facts.rawEventId, rawEventId))),
    db
      .select({ entityId: entities.id })
      .from(reconciliationOutputs)
      .innerJoin(
        entities,
        and(eq(entities.id, reconciliationOutputs.targetId), eq(entities.teamId, teamId)),
      )
      .where(
        and(
          eq(reconciliationOutputs.teamId, teamId),
          eq(reconciliationOutputs.status, 'applied'),
          inArray(reconciliationOutputs.targetKind, ['object', 'task']),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
          sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${reconciliationOutputs.sourceRefs}) AS source_ref
            WHERE source_ref ->> 'rawEventId' = ${rawEventId}
          )`,
        ),
      ),
    db
      .select({ entityId: entities.id })
      .from(artifactEvidenceAssociations)
      .innerJoin(
        artifactClusters,
        and(
          eq(artifactClusters.id, artifactEvidenceAssociations.clusterId),
          eq(artifactClusters.teamId, teamId),
        ),
      )
      .innerJoin(
        entities,
        and(eq(entities.id, artifactClusters.canonicalEntityId), eq(entities.teamId, teamId)),
      )
      .innerJoin(
        reconciliationEvidence,
        and(
          eq(reconciliationEvidence.id, artifactEvidenceAssociations.evidenceId),
          eq(reconciliationEvidence.teamId, teamId),
        ),
      )
      .where(
        and(
          eq(artifactEvidenceAssociations.teamId, teamId),
          sql`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId}) = ${rawEventId}`,
          isNull(entities.mergedIntoId),
        ),
      ),
  ]);
  return [...new Set([...factRows, ...outputRows, ...associationRows].map((row) => row.entityId))];
}

export async function invalidateObjectSummariesForRawEvent(
  db: Db,
  scope: TeamScopeCore,
  rawEventId: string,
  context: Record<string, unknown> = {},
  opts: { preserveExisting?: boolean } = {},
): Promise<string[]> {
  await scope.requireMembership();
  if (!UUID_RE.test(rawEventId)) return [];
  const entityIds = await objectIdsTouchedByRawEvent(db, scope.teamId, rawEventId);
  if (entityIds.length === 0) return [];

  if (!opts.preserveExisting) {
    await db
      .delete(objectSummaries)
      .where(
        and(eq(objectSummaries.teamId, scope.teamId), inArray(objectSummaries.entityId, entityIds)),
      );
    await Promise.all(
      entityIds.map((entityId) =>
        queue
          .enqueueObjectSummaryJob(
            { teamId: scope.teamId, objectId: entityId, trigger: 'auto' },
            { delayMs: OBJECT_SUMMARY_AUTO_DELAY_MS },
          )
          .catch((err: unknown) => {
            console.error('failed to enqueue object summary refresh', {
              err,
              ...context,
              rawEventId,
              entityId,
            });
          }),
      ),
    );
    return entityIds;
  }

  await Promise.all(
    entityIds.map((entityId) =>
      fireAndForgetObjectSummaryRefresh(db, scope, entityId, {
        ...context,
        rawEventId,
        entityId,
      }),
    ),
  );
  return entityIds;
}

export async function generateAndStoreObjectSummary(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  opts: { trigger?: 'manual' | 'auto' | 'retry' } = {},
  deps: GenerateDeps = {},
): Promise<{ status: 'ready' | 'skipped' | 'failed'; reason?: string; retryable?: boolean }> {
  const packet = await buildObjectSummaryPacket(db, scope, entityId);
  if (!packet) return { status: 'skipped', reason: 'not_found' };
  const now = new Date();
  const runRows = await db
    .insert(objectSummaryRuns)
    .values({
      teamId: scope.teamId,
      entityId,
      status: 'pending',
      trigger: opts.trigger ?? 'auto',
      promptVersion: OBJECT_SUMMARY_PROMPT_VERSION,
      inputFingerprint: packet.inputFingerprint,
      sourceCounts: packet.sourceCounts,
      startedAt: now,
    })
    .returning({ id: objectSummaryRuns.id });
  const runId = runRows[0]?.id;

  if (!packet.canGenerate) {
    await db
      .update(objectSummaryRuns)
      .set({
        status: 'skipped',
        errorCode: packet.cannotGenerateReason,
        finishedAt: new Date(),
      })
      .where(eq(objectSummaryRuns.id, runId ?? '00000000-0000-0000-0000-000000000000'));
    await db
      .delete(objectSummaries)
      .where(and(eq(objectSummaries.teamId, scope.teamId), eq(objectSummaries.entityId, entityId)));
    return { status: 'skipped', reason: packet.cannotGenerateReason ?? 'not_enough_object_memory' };
  }

  try {
    const structured = deps.chatStructured ?? chatStructured;
    const result = await structured({
      schema: generatedObjectSummarySchema,
      model: TIMELINE_MODELS.summarization.id,
      system:
        'You generate concise, grounded object summaries for a team memory product. Return valid JSON only.',
      prompt: promptForPacket(packet),
    });
    validateSummaryRefs(result.object, packet);
    const [currentSummary] = await db
      .select({ status: objectSummaries.status, staleAt: objectSummaries.staleAt })
      .from(objectSummaries)
      .where(and(eq(objectSummaries.teamId, scope.teamId), eq(objectSummaries.entityId, entityId)))
      .limit(1);
    if (
      currentSummary?.staleAt &&
      currentSummary.staleAt.getTime() > now.getTime() &&
      currentSummary.status !== 'ready'
    ) {
      await queue.enqueueObjectSummaryJob(
        { teamId: scope.teamId, objectId: entityId, trigger: 'auto' },
        { delayMs: OBJECT_SUMMARY_AUTO_DELAY_MS },
      );
      if (runId) {
        await db
          .update(objectSummaryRuns)
          .set({
            status: 'skipped',
            errorCode: 'stale_during_generation',
            finishedAt: new Date(),
          })
          .where(eq(objectSummaryRuns.id, runId));
      }
      return { status: 'skipped', reason: 'stale_during_generation' };
    }
    const plainText = summaryPlainText(result.object);
    const refs = allSummaryRefs(result.object);
    await db
      .insert(objectSummaries)
      .values({
        teamId: scope.teamId,
        entityId,
        status: 'ready',
        summary: result.object,
        plainText,
        sourceRefs: refs,
        sourceCounts: packet.sourceCounts,
        inputFingerprint: packet.inputFingerprint,
        model: result.model,
        promptVersion: OBJECT_SUMMARY_PROMPT_VERSION,
        generatedAt: new Date(),
        lastAttemptedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [objectSummaries.teamId, objectSummaries.entityId],
        set: {
          status: 'ready',
          summary: result.object,
          plainText,
          sourceRefs: refs,
          sourceCounts: packet.sourceCounts,
          inputFingerprint: packet.inputFingerprint,
          model: result.model,
          promptVersion: OBJECT_SUMMARY_PROMPT_VERSION,
          generatedAt: new Date(),
          staleAt: null,
          lastAttemptedAt: new Date(),
          lastErrorCode: null,
          updatedAt: new Date(),
        },
      });
    if (runId) {
      await db
        .update(objectSummaryRuns)
        .set({
          status: 'ready',
          model: result.model,
          finishedAt: new Date(),
        })
        .where(eq(objectSummaryRuns.id, runId));
    }
    await (deps.enqueueObjectEmbedJob ?? queue.enqueueObjectEmbedJob)(scope.teamId, entityId);
    return { status: 'ready' };
  } catch (err) {
    const errorCode = err instanceof Error ? err.message.slice(0, 120) : 'generation_failed';
    const retryable = isRetryableObjectSummaryError(err);
    await db
      .insert(objectSummaries)
      .values({
        teamId: scope.teamId,
        entityId,
        status: 'failed',
        sourceCounts: packet.sourceCounts,
        inputFingerprint: packet.inputFingerprint,
        promptVersion: OBJECT_SUMMARY_PROMPT_VERSION,
        lastAttemptedAt: new Date(),
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [objectSummaries.teamId, objectSummaries.entityId],
        set: {
          status: 'failed',
          sourceCounts: packet.sourceCounts,
          inputFingerprint: packet.inputFingerprint,
          promptVersion: OBJECT_SUMMARY_PROMPT_VERSION,
          lastAttemptedAt: new Date(),
          lastErrorCode: errorCode,
          updatedAt: new Date(),
          attemptCount: sql`${objectSummaries.attemptCount} + 1`,
        },
      });
    if (runId) {
      await db
        .update(objectSummaryRuns)
        .set({
          status: 'failed',
          errorCode,
          finishedAt: new Date(),
        })
        .where(eq(objectSummaryRuns.id, runId));
    }
    return { status: 'failed', reason: errorCode, retryable };
  }
}

export function sourceRefCitation(ref: ObjectSummarySourceRef): string {
  switch (ref.kind) {
    case 'fact':
      return `[fact:${ref.id}]`;
    case 'timeline_event':
      return artifactRefCitation({ kind: 'timeline_event', id: ref.id });
    case 'object_note':
      return artifactRefCitation({ kind: 'object_note', id: ref.id });
    case 'task':
      return artifactRefCitation({ kind: 'task', id: ref.id });
    case 'relationship':
      return `[rel:${ref.id}]`;
    case 'object_change':
      return `[chg:${ref.id}]`;
    case 'field':
      return `[field:${ref.id}]`;
  }
}
