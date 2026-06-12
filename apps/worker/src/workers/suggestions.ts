import {
  agentSuggestions,
  conversationReviews,
  entities,
  entityRelationships,
  factEntities,
  facts as factsTable,
  objectNotes,
  rawEvents,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import {
  conversationReview,
  getEnv,
  llm,
  queue,
  suggestions,
  time,
  withTeam,
} from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const SUGGESTION_CODE_VERSION = '2026-06-a';
const RECENT_CONTEXT_LIMIT = 5;
const OBJECT_PROMPT_LIMIT = 40;
const OBJECT_MATCHING_LIMIT = 500;
const CALENDAR_CONTEXT_PAST_DAYS = 30;
const CALENDAR_CONTEXT_FUTURE_DAYS = 180;
const NEXT_WEEKDAY_PATTERN =
  'monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun';
const COMMITMENT_TIME_PATTERN = new RegExp(
  `\\b(?:i'll|i will)\\s+(.+)\\s+(tomorrow|next\\s+(?:${NEXT_WEEKDAY_PATTERN}))\\b`,
  'i',
);
const DECISION_PATTERN =
  /(?:^|[.!?\n]\s*)(?:decision\s*:\s*|(?:we|team|the team)\s+(?:decided|agreed)\s+(?:to|that)\s+)([^.!?\n]+)/i;

interface SuggestionWorkerDeps {
  db: Db;
}

interface SuggestionWorkerIO {
  getEnv?: typeof getEnv;
  chatStructured?: typeof llm.chatStructured;
  modelId?: string;
  enqueueSuggestionJob?: typeof queue.enqueueSuggestionJob;
}

const suggestionItemSchema = z.object({
  operation: z.enum(['create', 'update', 'archive_or_cancel']),
  targetKind: z.enum(['task', 'object', 'calendar_event', 'object_note']),
  targetId: z.uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  proposedPayload: z.record(z.string(), z.unknown()),
});

const suggestionBundleSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).nullable().optional(),
  reason: z.string().max(1000).nullable().optional(),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  quote: z.string().max(1000).nullable().optional(),
  items: z.array(suggestionItemSchema).max(5),
});

const suggestionExtractionSchema = z.object({
  bundles: z.array(suggestionBundleSchema).max(5),
});

type SuggestionBundleOutput = z.infer<typeof suggestionBundleSchema>;
type SuggestionItemOutput = z.infer<typeof suggestionItemSchema>;
type EntityType = (typeof entities.$inferSelect)['type'];

function tokenizeEvidence(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4);
}

function minimalEvidenceForBundle(args: {
  bundle: SuggestionBundleOutput;
  fallbackRawEventId: string;
  fallbackText: string;
  window: conversationReview.ConversationEvidenceEvent[] | null;
}): suggestions.SuggestionEvidenceInput[] {
  if (!args.window || args.window.length === 0) {
    return [
      {
        rawEventId: args.fallbackRawEventId,
        quote: args.bundle.quote ?? truncate(args.fallbackText, 500),
      },
    ];
  }
  const haystack = [
    args.bundle.title,
    args.bundle.summary ?? '',
    args.bundle.reason ?? '',
    args.bundle.quote ?? '',
    ...args.bundle.items.map((item) => `${item.title} ${JSON.stringify(item.proposedPayload)}`),
  ].join(' ');
  const tokens = new Set(tokenizeEvidence(haystack));
  const scored = args.window
    .map((event) => {
      const eventTokens = new Set(tokenizeEvidence(event.contentText));
      let score = 0;
      for (const token of tokens) if (eventTokens.has(token)) score += 1;
      return { event, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.event.occurredAt.getTime() - b.event.occurredAt.getTime(),
    )
    .slice(0, 4);
  const fallbackEvent = args.window.at(-1);
  if (!fallbackEvent) return [];
  const picked = scored.length > 0 ? scored.map((entry) => entry.event) : [fallbackEvent];
  return picked.map((event) => ({
    rawEventId: event.id,
    quote:
      args.bundle.quote && event.contentText.includes(args.bundle.quote)
        ? args.bundle.quote
        : truncate(event.contentText, 500),
    metadata: { conversation_evidence: true },
  }));
}

function makeModelVersion(modelId: string): string {
  return `${modelId}@${SUGGESTION_CODE_VERSION}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function normalizeSuggestionItemPayload(
  item: z.infer<typeof suggestionItemSchema>,
  objectType?: EntityType | null,
): Record<string, unknown> {
  const payload = { ...item.proposedPayload };
  if (item.targetKind === 'object_note') return payload;
  const lifecycleType = lifecycleStatusTypeForPayload(item, payload, objectType);
  if (lifecycleType && typeof payload.status === 'string') {
    payload.status = normalizeLifecycleStatus(payload.status, lifecycleType);
  }
  if (
    item.operation === 'create' &&
    (item.targetKind === 'task' || item.targetKind === 'object') &&
    (typeof payload.canonicalName !== 'string' || payload.canonicalName.trim() === '')
  ) {
    return { ...payload, canonicalName: item.title };
  }
  return payload;
}

type LifecycleStatusType = 'task' | 'follow_up' | 'project';

function lifecycleStatusTypeForPayload(
  item: Pick<z.infer<typeof suggestionItemSchema>, 'targetKind'>,
  payload: Record<string, unknown>,
  objectType?: EntityType | null,
): LifecycleStatusType | null {
  if (item.targetKind === 'task') return 'task';
  if (item.targetKind !== 'object') return null;
  const type =
    objectType ??
    (typeof payload.type === 'string' && ENTITY_TYPES.has(payload.type.trim() as EntityType)
      ? (payload.type.trim() as EntityType)
      : null);
  return type === 'task' || type === 'follow_up' || type === 'project' ? type : null;
}

function normalizeLifecycleStatus(value: string, type: LifecycleStatusType): string {
  const status = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (type === 'project') {
    if (status === 'in progress' || status === 'in_progress' || status === 'in-progress') {
      return 'active';
    }
    if (status === 'started' || status === 'doing') return 'active';
    if (status === 'completed' || status === 'complete' || status === 'finished') return 'shipped';
    if (status === 'done') return 'shipped';
    if (status === 'canceled') return 'cancelled';
    return status;
  }
  if (
    status === 'in progress' ||
    status === 'in_progress' ||
    status === 'in-progress' ||
    status === 'started'
  ) {
    return 'doing';
  }
  if (status === 'completed' || status === 'complete' || status === 'finished') return 'done';
  if (status === 'open') return 'todo';
  if (status === 'canceled') return 'cancelled';
  return status;
}

function extractionSettled(meta: Record<string, unknown>): boolean {
  return (
    typeof meta.extraction_model_version === 'string' ||
    typeof meta.extracted_at === 'string' ||
    typeof meta.extraction_skipped_at === 'string' ||
    typeof meta.extraction_failed_at === 'string'
  );
}

async function stampSuggestionMetadata(
  db: Db,
  rawEventId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${JSON.stringify(
        patch,
      )}::jsonb`,
    })
    .where(eq(rawEvents.id, rawEventId));
}

function commitmentActionBeforeTimePhrase(s: string): string {
  const fragment =
    s
      .split(/[.!?\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1) ?? s.trim();
  return fragment.replace(/^(?:and|then|also)\s+/i, '').trim();
}

function fallbackDecisionBundle(text: string): SuggestionBundleOutput | null {
  const match = DECISION_PATTERN.exec(text.trim());
  const decision = match?.[1]?.replace(/\s+/g, ' ').trim();
  if (!decision) return null;
  const canonicalName = `${decision.charAt(0).toUpperCase()}${decision.slice(1)}`;
  const payload: Record<string, unknown> = {
    type: 'decision',
    canonicalName: truncate(canonicalName, 200),
    status: 'accepted',
    metadata: { extracted_from_decision_fallback: true },
  };
  return {
    title: `Decision: ${String(payload.canonicalName)}`,
    summary: truncate(text, 500),
    reason: 'The source explicitly states a decision.',
    confidence: 'medium',
    quote: truncate(text, 500),
    items: [
      {
        operation: 'create',
        targetKind: 'object',
        title: String(payload.canonicalName),
        proposedPayload: payload,
      },
    ],
  };
}

function calendarContextRange(occurredAt: Date): { from: Date; to: Date } {
  const from = new Date(occurredAt);
  from.setUTCDate(from.getUTCDate() - CALENDAR_CONTEXT_PAST_DAYS);
  const to = new Date(occurredAt);
  to.setUTCDate(to.getUTCDate() + CALENDAR_CONTEXT_FUTURE_DAYS);
  return { from, to };
}

export function fallbackBundles(args: {
  text: string;
  timezone: string;
  occurredAt: Date;
  authorUserId: string | null;
}): SuggestionBundleOutput[] {
  const text = args.text.trim();
  const bundles: SuggestionBundleOutput[] = [];
  const decisionBundle = fallbackDecisionBundle(text);
  if (decisionBundle) bundles.push(decisionBundle);
  const match = COMMITMENT_TIME_PATTERN.exec(text);
  if (!match) return bundles;
  const action = commitmentActionBeforeTimePhrase(match[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const phrase = match[2] ?? 'tomorrow';
  if (!action) return bundles;
  const resolved = time.resolveTimePhrase(phrase, {
    timezone: args.timezone,
    referenceDate: args.occurredAt,
  });
  const taskPayload: Record<string, unknown> = {
    canonicalName: `${action.charAt(0).toUpperCase()}${action.slice(1)}`,
    dueAt: resolved?.from.toISOString() ?? null,
    ownerUserId: args.authorUserId,
    metadata: { extracted_from_commitment: true, time_phrase: phrase },
  };
  const items: z.infer<typeof suggestionItemSchema>[] = [
    {
      operation: 'create',
      targetKind: 'task',
      title: String(taskPayload.canonicalName),
      proposedPayload: taskPayload,
    },
  ];
  if (resolved) {
    items.push({
      operation: 'create',
      targetKind: 'calendar_event',
      title: String(taskPayload.canonicalName),
      proposedPayload: {
        title: String(taskPayload.canonicalName),
        startAt: resolved.from.toISOString(),
        endAt: resolved.to.toISOString(),
        startDate: resolved.localStartDate,
        endDate: resolved.localEndDate,
        timezone: args.timezone,
        allDay: true,
        visibility: 'team',
        description: `Commitment extracted from: ${truncate(text, 240)}`,
      },
    });
  }
  bundles.push({
    title: `Commitment: ${String(taskPayload.canonicalName)}`,
    summary: truncate(text, 500),
    reason: 'A team member said they would do this work.',
    confidence: 'medium',
    quote: truncate(text, 500),
    items,
  });
  return bundles;
}

export async function processSuggestionJobForTests(
  deps: SuggestionWorkerDeps,
  data: queue.SuggestionJobData,
  io: SuggestionWorkerIO = {},
): Promise<void> {
  if ('scope' in data && data.scope === 'object_cleanup') {
    await processObjectCleanupJob(deps, data);
    return;
  }

  const env = (io.getEnv ?? getEnv)();
  if (!env.OPENROUTER_API_KEY) {
    throw new UnrecoverableError('suggestions: OPENROUTER_API_KEY not configured');
  }
  const modelId = io.modelId ?? llm.TIMELINE_MODELS.extraction.id;
  const modelVersion = makeModelVersion(modelId);

  if ('scope' in data) {
    await processConversationReviewJob(deps, data, { ...io, modelId }, modelVersion);
    return;
  }

  const { rawEventId, teamId } = data;

  const rows = await deps.db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`raw event ${rawEventId} not found`);
  if (row.teamId !== teamId) throw new UnrecoverableError(`raw event ${rawEventId} team mismatch`);
  const identity = conversationReview.conversationIdentityForRawEvent(row);
  if (identity) {
    if (row.visibility !== 'team') {
      await stampSuggestionMetadata(deps.db, rawEventId, {
        suggestions_skipped_at: new Date().toISOString(),
        suggestions_skipped_reason: `visibility=${row.visibility}`,
        suggestion_model_version: modelVersion,
      });
      return;
    }
    await scheduleConversationReview(deps, row, identity, io);
    return;
  }
  await runSuggestionExtraction(deps, {
    anchor: row,
    teamId,
    modelVersion,
    modelId,
    io,
  });
}

type CleanupObjectRow = Pick<
  typeof entities.$inferSelect,
  'id' | 'teamId' | 'type' | 'canonicalName' | 'aliases' | 'status' | 'updatedAt'
>;

const CLEANUP_MERGE_TYPES = new Set([
  'person',
  'company',
  'project',
  'topic',
  'deal',
  'vendor',
  'incident',
  'document',
  'decision',
  'hiring_loop',
  'other',
]);

const ENTITY_TYPES = new Set<EntityType>([
  'person',
  'company',
  'project',
  'topic',
  'other',
  'deal',
  'vendor',
  'incident',
  'document',
  'decision',
  'hiring_loop',
  'task',
  'follow_up',
]);

const GENERIC_TOOL_NAMES = new Set([
  'calendar',
  'clock',
  'drive',
  'excel',
  'finder',
  'github',
  'googledrive',
  'googlemeet',
  'linkedin',
  'meet',
  'slack',
  'telegram',
  'tiktok',
  'twitter',
  'whatsapp',
  'x',
  'youtube',
  'zoom',
]);

const LOW_SIGNAL_OBJECT_NAMES = new Set(['auditfirms', 'bigfour', 'link', 'post', 'tweet', 'url']);

function cleanupCompatible(a: CleanupObjectRow, b: CleanupObjectRow): boolean {
  return (
    a.type === b.type ||
    ((a.type === 'company' || a.type === 'vendor') && (b.type === 'company' || b.type === 'vendor'))
  );
}

function normalizeCleanupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\b(inc|llc|ltd|oy|corp|corporation|company|co|gmbh|plc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizePersonHandle(value: string): string {
  return normalizeCleanupName(value).replace(/0/g, 'o');
}

function cleanupNames(row: CleanupObjectRow): string[] {
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.filter((v): v is string => typeof v === 'string')
    : [];
  const rawNames = [row.canonicalName, ...aliases];
  const names = rawNames.map(normalizeCleanupName);
  if (row.type === 'person') names.push(...rawNames.map(normalizePersonHandle));
  return Array.from(new Set(names.filter((name) => name.length >= 2)));
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] ?? 0)
          : Math.min(previous[j] ?? 0, current[j - 1] ?? 0, previous[j - 1] ?? 0) + 1;
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function hasConflictingNumberSuffix(a: string, b: string): boolean {
  const left = /^(.+?)(\d+)$/.exec(a);
  const right = /^(.+?)(\d+)$/.exec(b);
  return Boolean(left && right && left[1] === right[1] && left[2] !== right[2]);
}

function cleanupMatch(a: CleanupObjectRow, b: CleanupObjectRow): 'exact' | 'near' | null {
  if (!cleanupCompatible(a, b)) return null;
  const aNames = cleanupNames(a);
  const bNames = cleanupNames(b);
  if (aNames.some((name) => bNames.includes(name))) return 'exact';
  if (a.type === 'person' && b.type === 'person') {
    const aFirst = normalizePersonHandle(a.canonicalName.split(/\s+/)[0] ?? '');
    const bFirst = normalizePersonHandle(b.canonicalName.split(/\s+/)[0] ?? '');
    if (aFirst.length >= 3 && aFirst === bFirst) return 'near';
  }
  for (const left of aNames) {
    for (const right of bNames) {
      if (hasConflictingNumberSuffix(left, right)) continue;
      const min = Math.min(left.length, right.length);
      const max = Math.max(left.length, right.length);
      if (min >= 5 && (left.includes(right) || right.includes(left))) return 'near';
      if (min >= 3 && max <= 8 && levenshtein(left, right) <= 1) return 'near';
    }
  }
  return null;
}

function aliasesForRow(row: Pick<CleanupObjectRow, 'aliases'>): string[] {
  return Array.isArray(row.aliases)
    ? row.aliases.filter((value): value is string => typeof value === 'string')
    : [];
}

function itemCreateType(item: SuggestionItemOutput): EntityType {
  if (item.targetKind === 'task') return 'task';
  const type = item.proposedPayload.type;
  return typeof type === 'string' && ENTITY_TYPES.has(type.trim() as EntityType)
    ? (type.trim() as EntityType)
    : 'other';
}

function itemCanonicalName(item: SuggestionItemOutput): string {
  const name = item.proposedPayload.canonicalName;
  return typeof name === 'string' && name.trim() ? name.trim() : item.title.trim();
}

function payloadHasKey(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function hasDurableCreatePayload(payload: Record<string, unknown>): boolean {
  const durableKeys = ['status', 'stage', 'priority', 'ownerUserId', 'assigneeUserId', 'dueAt'];
  if (durableKeys.some((key) => payloadHasKey(payload, key))) return true;
  return (
    payload.metadata !== null &&
    typeof payload.metadata === 'object' &&
    !Array.isArray(payload.metadata) &&
    Object.keys(payload.metadata).length > 0
  );
}

function hasDurableNonMetadataCreatePayload(payload: Record<string, unknown>): boolean {
  return ['status', 'stage', 'priority', 'ownerUserId', 'assigneeUserId', 'dueAt'].some((key) =>
    payloadHasKey(payload, key),
  );
}

function lowSignalCreateObject(item: SuggestionItemOutput): boolean {
  if (item.operation !== 'create' || item.targetKind !== 'object') return false;
  const normalized = normalizeCleanupName(itemCanonicalName(item));
  if (!normalized) return true;
  const type = itemCreateType(item);
  const lowSignal =
    (type === 'company' || type === 'topic' || type === 'other') &&
    (GENERIC_TOOL_NAMES.has(normalized) || LOW_SIGNAL_OBJECT_NAMES.has(normalized));
  if (!lowSignal) return false;
  if (hasDurableNonMetadataCreatePayload(item.proposedPayload)) return false;
  return (
    payloadHasKey(item.proposedPayload, 'metadata') ||
    !hasDurableCreatePayload(item.proposedPayload)
  );
}

function existingMatchForCreate(
  item: SuggestionItemOutput,
  rows: CleanupObjectRow[],
): CleanupObjectRow | null {
  if (item.operation !== 'create' || (item.targetKind !== 'object' && item.targetKind !== 'task')) {
    return null;
  }
  const candidate: CleanupObjectRow = {
    id: 'candidate',
    teamId: rows[0]?.teamId ?? '',
    type: itemCreateType(item),
    canonicalName: itemCanonicalName(item),
    aliases: Array.isArray(item.proposedPayload.aliases) ? item.proposedPayload.aliases : [],
    status: 'suggested',
    updatedAt: new Date(0),
  };
  const matches = rows
    .map((row) => ({ row, match: cleanupMatch(candidate, row) }))
    .filter((entry): entry is { row: CleanupObjectRow; match: 'exact' | 'near' } =>
      Boolean(entry.match),
    );
  if (matches.length === 0) return null;
  const exact = matches.filter((entry) => entry.match === 'exact');
  const pool = exact.length > 0 ? exact : matches;
  if (pool.length !== 1) return null;
  return pickCleanupSurvivor(pool.map((entry) => entry.row));
}

function updatePayloadFromCreate(
  item: SuggestionItemOutput,
  aliases: string[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of ['status', 'stage', 'priority', 'ownerUserId', 'assigneeUserId', 'dueAt']) {
    if (payloadHasKey(item.proposedPayload, key)) payload[key] = item.proposedPayload[key];
  }
  if (aliases.length > 0) payload.aliases = aliases;
  return payload;
}

function normalizeBundleAgainstExistingObjects(
  bundle: SuggestionBundleOutput,
  rows: CleanupObjectRow[],
): SuggestionBundleOutput {
  const items = bundle.items
    .filter((item) => !lowSignalCreateObject(item))
    .map((item) => {
      const match = existingMatchForCreate(item, rows);
      if (!match) return item;
      const aliases = Array.from(
        new Set([
          ...aliasesForRow(match),
          itemCanonicalName(item),
          ...aliasesForRow({ aliases: item.proposedPayload.aliases }),
        ]),
      ).filter((alias) => alias.toLowerCase() !== match.canonicalName.toLowerCase());
      return {
        ...item,
        operation: 'update' as const,
        targetKind: match.type === 'task' ? ('task' as const) : ('object' as const),
        targetId: match.id,
        title: `Update ${match.canonicalName}`,
        proposedPayload: updatePayloadFromCreate(item, aliases),
      };
    });
  return { ...bundle, items };
}

function pickCleanupSurvivor(rows: CleanupObjectRow[]): CleanupObjectRow {
  const [survivor] = rows
    .slice()
    .sort(
      (a, b) =>
        (Array.isArray(b.aliases) ? b.aliases.length : 0) -
          (Array.isArray(a.aliases) ? a.aliases.length : 0) ||
        b.canonicalName.length - a.canonicalName.length ||
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  if (!survivor) throw new Error('cleanup survivor requires at least one object');
  return survivor;
}

async function rejectedSuggestionExists(
  db: Db,
  teamId: string,
  dedupeKey: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: agentSuggestions.id })
    .from(agentSuggestions)
    .where(
      and(
        eq(agentSuggestions.teamId, teamId),
        eq(agentSuggestions.dedupeKey, dedupeKey),
        eq(agentSuggestions.status, 'rejected'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function processObjectCleanupJob(
  deps: SuggestionWorkerDeps,
  data: queue.SuggestionObjectCleanupJobData,
): Promise<void> {
  const teamIds =
    data.teamId === '__all__'
      ? (
          await deps.db
            .selectDistinct({ teamId: entities.teamId })
            .from(entities)
            .where(and(isNull(entities.archivedAt), isNull(entities.mergedIntoId)))
        ).map((row) => row.teamId)
      : [data.teamId];
  for (const teamId of teamIds) {
    await createObjectCleanupSuggestionsForTeam(deps.db, teamId, data.triggeredBy ?? 'daily');
  }
}

async function createObjectCleanupSuggestionsForTeam(
  db: Db,
  teamId: string,
  triggeredBy: string,
): Promise<void> {
  const rows = await db
    .select({
      id: entities.id,
      teamId: entities.teamId,
      type: entities.type,
      canonicalName: entities.canonicalName,
      aliases: entities.aliases,
      status: entities.status,
      updatedAt: entities.updatedAt,
    })
    .from(entities)
    .where(
      and(eq(entities.teamId, teamId), isNull(entities.archivedAt), isNull(entities.mergedIntoId)),
    )
    .orderBy(desc(entities.updatedAt))
    .limit(500);
  const scope = withTeam(db, teamId, PSEUDO_USER, { skipMembershipCheck: true });
  const mergeCandidates = rows.filter((row) => CLEANUP_MERGE_TYPES.has(row.type));
  const proposedMergeKeys = new Set<string>();

  for (const [i, left] of mergeCandidates.entries()) {
    for (const right of mergeCandidates.slice(i + 1)) {
      const match = cleanupMatch(left, right);
      if (!match) continue;
      const objectIds = [left.id, right.id].sort();
      const groupKey = objectIds.join('|');
      if (proposedMergeKeys.has(groupKey)) continue;
      proposedMergeKeys.add(groupKey);
      const survivor = pickCleanupSurvivor([left, right]);
      const reason =
        match === 'exact'
          ? 'Names or aliases match closely enough to review as a duplicate.'
          : 'Names are similar enough to review as a possible duplicate.';
      const dedupeKey = suggestions.suggestionDedupeKey({
        kind: 'object_cleanup_merge',
        teamId,
        objectIds,
      });
      if (await rejectedSuggestionExists(db, teamId, dedupeKey)) continue;
      await scope.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: `Merge duplicate objects: ${left.canonicalName} / ${right.canonicalName}`,
        summary: 'Two objects look like they may represent the same thing.',
        reason,
        confidence: match === 'exact' ? 'high' : 'medium',
        dedupeKey,
        metadata: {
          kind: 'object_cleanup',
          cleanup_kind: 'merge',
          triggered_by: triggeredBy,
          object_ids: objectIds,
        },
        items: [
          {
            operation: 'merge',
            targetKind: 'object_merge',
            targetId: survivor.id,
            title: `Review merge for ${survivor.canonicalName}`,
            description: reason,
            dedupeKey,
            proposedPayload: {
              objectIds,
              survivorId: survivor.id,
              reason,
            },
          },
        ],
      });
    }
  }

  const protectedIds = new Set<string>();
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    const [noteRows, relationshipRows, factRows] = await Promise.all([
      db
        .select({ entityId: objectNotes.entityId, total: count() })
        .from(objectNotes)
        .where(
          and(
            eq(objectNotes.teamId, teamId),
            inArray(objectNotes.entityId, ids),
            isNull(objectNotes.deletedAt),
          ),
        )
        .groupBy(objectNotes.entityId),
      db
        .select({ id: entities.id, total: count() })
        .from(entities)
        .innerJoin(
          entityRelationships,
          or(
            eq(entityRelationships.fromEntityId, entities.id),
            eq(entityRelationships.toEntityId, entities.id),
          ),
        )
        .where(and(eq(entities.teamId, teamId), inArray(entities.id, ids)))
        .groupBy(entities.id),
      db
        .select({ entityId: factEntities.entityId, total: count() })
        .from(factEntities)
        .innerJoin(factsTable, eq(factsTable.id, factEntities.factId))
        .where(and(eq(factsTable.teamId, teamId), inArray(factEntities.entityId, ids)))
        .groupBy(factEntities.entityId),
    ]);
    for (const row of [...noteRows, ...factRows]) {
      if (row.total > 0) protectedIds.add(row.entityId);
    }
    for (const row of relationshipRows) {
      if (row.total > 0) protectedIds.add(row.id);
    }
  }

  for (const row of rows) {
    const normalized = normalizeCleanupName(row.canonicalName);
    if (!GENERIC_TOOL_NAMES.has(normalized)) continue;
    if (row.type === 'task' || row.type === 'follow_up') continue;
    if (protectedIds.has(row.id)) continue;
    const dedupeKey = suggestions.suggestionDedupeKey({
      kind: 'object_cleanup_archive',
      teamId,
      objectId: row.id,
      evidenceHash: normalized,
    });
    if (await rejectedSuggestionExists(db, teamId, dedupeKey)) continue;
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: `Archive low-signal object: ${row.canonicalName}`,
      summary:
        'This object looks like a generic tool or app name with no attached notes, facts, or links.',
      reason: 'Cleanup archive candidates are limited to weak-evidence tool-like objects.',
      confidence: 'medium',
      dedupeKey,
      metadata: {
        kind: 'object_cleanup',
        cleanup_kind: 'archive',
        triggered_by: triggeredBy,
        object_id: row.id,
      },
      items: [
        {
          operation: 'archive_or_cancel',
          targetKind: 'object',
          targetId: row.id,
          title: `Archive ${row.canonicalName}`,
          description: 'Archive this low-signal object.',
          dedupeKey,
          proposedPayload: {},
        },
      ],
    });
  }
}

async function runSuggestionExtraction(
  deps: SuggestionWorkerDeps,
  args: {
    anchor: typeof rawEvents.$inferSelect;
    teamId: string;
    modelVersion: string;
    modelId: string;
    io: SuggestionWorkerIO;
    conversation?: {
      reviewId: string;
      key: string;
      window: conversationReview.ConversationEvidenceEvent[];
      linkedContext: conversationReview.ConversationLinkedContextEvent[];
    };
  },
): Promise<number> {
  const { anchor: row, teamId, modelVersion, modelId, io } = args;
  const rawEventId = row.id;
  const text = row.contentText?.trim();
  if (!text) throw new UnrecoverableError(`raw event ${rawEventId} has no content_text`);
  const meta =
    row.sourceMetadata && typeof row.sourceMetadata === 'object'
      ? (row.sourceMetadata as Record<string, unknown>)
      : {};
  if (row.visibility !== 'team') {
    await stampSuggestionMetadata(deps.db, rawEventId, {
      suggestions_skipped_at: new Date().toISOString(),
      suggestions_skipped_reason: `visibility=${row.visibility}`,
      suggestion_model_version: modelVersion,
    });
    return 0;
  }
  if (!args.conversation && meta.suggestion_model_version === modelVersion) return 0;

  const hasSettledExtraction = extractionSettled(meta);
  if (
    !args.conversation &&
    !hasSettledExtraction &&
    meta.suggestion_pre_extract_model_version === modelVersion
  ) {
    return 0;
  }
  const factRows = await deps.db
    .select({ statement: factsTable.statement })
    .from(factsTable)
    .where(eq(factsTable.rawEventId, rawEventId))
    .limit(20);

  const entityRows = await deps.db
    .select({
      id: entities.id,
      teamId: entities.teamId,
      type: entities.type,
      name: entities.canonicalName,
      aliases: entities.aliases,
      status: entities.status,
      updatedAt: entities.updatedAt,
    })
    .from(entities)
    .where(
      and(eq(entities.teamId, teamId), isNull(entities.mergedIntoId), isNull(entities.archivedAt)),
    )
    .orderBy(desc(entities.updatedAt))
    .limit(OBJECT_PROMPT_LIMIT);

  const matchingEntityRows = await deps.db
    .select({
      id: entities.id,
      teamId: entities.teamId,
      type: entities.type,
      name: entities.canonicalName,
      aliases: entities.aliases,
      status: entities.status,
      updatedAt: entities.updatedAt,
    })
    .from(entities)
    .where(
      and(eq(entities.teamId, teamId), isNull(entities.mergedIntoId), isNull(entities.archivedAt)),
    )
    .orderBy(desc(entities.updatedAt))
    .limit(OBJECT_MATCHING_LIMIT);

  const qnaNoteRows = await deps.db
    .select({
      id: objectNotes.id,
      entityId: objectNotes.entityId,
      body: objectNotes.body,
      updatedAt: objectNotes.updatedAt,
      entityType: entities.type,
      entityName: entities.canonicalName,
    })
    .from(objectNotes)
    .innerJoin(entities, eq(entities.id, objectNotes.entityId))
    .where(
      and(
        eq(objectNotes.teamId, teamId),
        isNull(objectNotes.deletedAt),
        isNull(entities.mergedIntoId),
        isNull(entities.archivedAt),
        or(sql`${objectNotes.body} ilike 'Q:%'`, sql`${objectNotes.body} ilike ${'%\nA:%'}`),
      ),
    )
    .orderBy(desc(objectNotes.updatedAt))
    .limit(40);

  const memberRows = await deps.db
    .select({ userId: teamMembers.userId, name: users.name, email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt)))
    .limit(50);
  const activeAuthorUserId = memberRows.some((member) => member.userId === row.authorUserId)
    ? row.authorUserId
    : null;

  const scope = withTeam(deps.db, teamId, PSEUDO_USER, {
    skipMembershipCheck: true,
  });
  const settings = await scope.calendar.getCalendarSettings();
  const workspaceTime = time.workspaceTimeContext(settings.defaultTimezone, row.occurredAt);

  const recentRows = await deps.db
    .select({ occurredAt: rawEvents.occurredAt, text: rawEvents.contentText })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        lt(rawEvents.occurredAt, row.occurredAt),
        eq(rawEvents.visibility, 'team'),
      ),
    )
    .orderBy(desc(rawEvents.occurredAt))
    .limit(RECENT_CONTEXT_LIMIT);

  const calendarRows = await scope.calendar.listCalendarEvents({
    ...calendarContextRange(row.occurredAt),
    limit: 40,
  });

  const objectRowsForMatching: CleanupObjectRow[] = matchingEntityRows.map((entity) => ({
    id: entity.id,
    teamId: entity.teamId,
    type: entity.type,
    canonicalName: entity.name,
    aliases: entity.aliases,
    status: entity.status,
    updatedAt: entity.updatedAt,
  }));

  const prompt = llm.truncateTextToTokenBudget(
    buildPrompt({
      text,
      occurredAt: row.occurredAt,
      workspaceTime,
      facts: factRows.map((f) => f.statement),
      members: memberRows,
      objects: entityRows.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        aliases: aliasesForRow({ aliases: e.aliases }),
        status: e.status,
      })),
      qnaNotes: qnaNoteRows.map((note) => ({
        id: note.id,
        entityId: note.entityId,
        entityType: note.entityType,
        entityName: note.entityName,
        body: note.body,
      })),
      calendar: calendarRows
        .filter((ev) => ev.visibility === 'team')
        .map((ev) => ({
          id: ev.id,
          title: ev.title,
          startAt: ev.startAt.toISOString(),
          allDay: ev.allDay,
        })),
      recent: recentRows,
      conversationWindow: args.conversation?.window ?? null,
      linkedContext: args.conversation?.linkedContext ?? [],
    }),
    llm.inputTokenBudgetFor(llm.TIMELINE_MODELS.extraction),
  );

  const chatStructured = io.chatStructured ?? llm.chatStructured;
  const result = await chatStructured({
    schema: suggestionExtractionSchema,
    model: modelId,
    system:
      'Extract proposed workspace changes from natural team conversation. Return only commitments that imply future work, deadlines, scheduled obligations, durable decisions, object updates, calendar refinements, reusable Q&A notes, or clear lifecycle updates to existing lifecycle-capable artifacts. Do not invent. Use proposal rows only; never claim changes are applied. Return no bundles when the evidence is ambiguous, contradicted, merely conversational, could match multiple existing artifacts, or only says someone shared/sent/forwarded a link, post, file, reaction, app mention, or platform handle. Prefer updating an existing workspace object over creating one whenever the name, alias, person nickname, handle, company suffix variant, or conversation context plausibly matches exactly one object in the prompt. Create a task/object only when the evidence contains durable information and no plausible existing or pending object matches. For create task/object items, include proposedPayload.canonicalName matching the item title. For reusable Q&A, create or update an object_note item only when the conversation contains an explicit question and an explicit answer likely to help future teammates; do not create Q&A notes for vague replies, handoffs, guesses, one-off lookups, or generic summaries. Q&A note bodies must use "Q: ..." then "A: ..." and may include a short "Source: ..." line only if it is supported by the evidence. Attach Q&A notes to the one clearly relevant existing object with proposedPayload.entityId and body. If no object fits but the Q&A is high-signal, include a create object item with proposedPayload.type="topic" and canonicalName, then include an object_note create item whose proposedPayload uses entityName and entityType="topic" plus body. For updating an existing Q&A note, return targetKind="object_note", operation="update", targetId=<note uuid>, proposedPayload.body=<replacement body> only when the same reusable question is clearly matched. Use canonical lifecycle statuses for the target type: task todo/doing/done/blocked/cancelled, follow_up todo/doing/done/cancelled, project planning/active/on_hold/shipped/cancelled. Normalize aliases into that target vocabulary: for task/follow_up, "in progress" means doing and "completed" means done; for project, "started" or "in progress" means active and "completed" or "done" means shipped; "canceled" means cancelled only when the target type supports cancelled. For clear lifecycle movement, return an update item targeting the existing artifact UUID; progress/doing/active requires explicit workflow movement such as "started" or "working on", not "looked at" or "thinking about". Completion can come from any credible assertive source; hedged guesses like "I think it is done" are evidence only. Cancellation, blocking, and unblocking must map cleanly to the target artifact vocabulary. If multiple plausible artifacts match, return no lifecycle proposal. For clear calendar reschedules/refinements/cancellations, target the existing calendar event UUID and use update or archive_or_cancel. For date-only scheduled commitments, create all-day calendar_event items. For durable decisions, create object items with proposedPayload.type="decision"; use status="accepted" for clear accepted decisions and status="proposed" only when the evidence clearly says the decision is not final. Use UUIDs only from the prompt when targeting existing records.',
    prompt,
  });

  if (
    args.conversation &&
    !(await isConversationReviewCurrent(deps.db, args.conversation.reviewId, rawEventId))
  ) {
    return 0;
  }

  const bundles =
    result.object.bundles.length > 0
      ? result.object.bundles.map((bundle) =>
          normalizeBundleAgainstExistingObjects(bundle, objectRowsForMatching),
        )
      : args.conversation
        ? []
        : fallbackBundles({
            text,
            timezone: settings.defaultTimezone,
            occurredAt: row.occurredAt,
            authorUserId: activeAuthorUserId,
          });
  const objectTypeById = new Map(entityRows.map((entity) => [entity.id, entity.type]));

  let proposalsCreated = 0;
  for (const bundle of bundles) {
    if (bundle.items.length === 0) continue;
    if (
      args.conversation &&
      !(await isConversationReviewCurrent(deps.db, args.conversation.reviewId, rawEventId))
    ) {
      return proposalsCreated;
    }
    const bundleDedupe = suggestions.suggestionDedupeKey({
      rawEventId: args.conversation ? null : rawEventId,
      conversationKey: args.conversation?.key ?? null,
      title: bundle.title,
      items: args.conversation ? null : bundle.items,
    });
    const evidence = minimalEvidenceForBundle({
      bundle,
      fallbackRawEventId: rawEventId,
      fallbackText: text,
      window: args.conversation?.window ?? null,
    });
    const suggestion = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: bundle.title,
      summary: bundle.summary ?? null,
      reason: bundle.reason ?? null,
      confidence: bundle.confidence,
      dedupeKey: bundleDedupe,
      visibility: row.visibility,
      visibilityOwnerUserId: null,
      visibilityUserIds: null,
      evidence,
      metadata: {
        suggestion_model_version: modelVersion,
        ...(args.conversation
          ? {
              conversation_review_id: args.conversation.reviewId,
              conversation_key: args.conversation.key,
              evidence_window_hash: suggestions.suggestionDedupeKey(
                args.conversation.window.map((ev) => ev.id),
              ),
              review_outcome: 'proposal',
            }
          : {}),
      },
      items: bundle.items.map((item, index) => ({
        operation: item.operation,
        targetKind: item.targetKind,
        targetId: item.targetId ?? null,
        title: item.title,
        description: item.description ?? null,
        dedupeKey: suggestions.suggestionDedupeKey({
          rawEventId: args.conversation ? null : rawEventId,
          bundleDedupe,
          index,
          operation: item.operation,
          targetKind: item.targetKind,
          targetId: item.targetId ?? null,
          title: item.title,
          item,
        }),
        proposedPayload: normalizeSuggestionItemPayload(
          item,
          item.targetKind === 'object' && item.operation !== 'create'
            ? (objectTypeById.get(item.targetId ?? '') ?? null)
            : null,
        ),
      })),
    });
    if (suggestion.status === 'pending' || suggestion.status === 'partially_resolved') {
      proposalsCreated += 1;
    }
  }

  await stampSuggestionMetadata(
    deps.db,
    rawEventId,
    args.conversation
      ? {
          conversation_reviewed_at: new Date().toISOString(),
          conversation_review_id: args.conversation.reviewId,
          conversation_key: args.conversation.key,
          suggestion_model_version: modelVersion,
        }
      : hasSettledExtraction
        ? {
            suggestion_model_version: modelVersion,
            suggestions_extracted_at: new Date().toISOString(),
          }
        : {
            suggestion_pre_extract_model_version: modelVersion,
            suggestions_pre_extracted_at: new Date().toISOString(),
          },
  );
  return proposalsCreated;
}

async function scheduleConversationReview(
  deps: SuggestionWorkerDeps,
  row: typeof rawEvents.$inferSelect,
  identity: conversationReview.ConversationIdentity,
  io: SuggestionWorkerIO,
): Promise<void> {
  const quietUntil = conversationReview.quietUntilFor();
  const anchorMetadata = {
    kind: identity.kind,
    last_anchor_raw_event_id: row.id,
    last_anchor_occurred_at: row.occurredAt.toISOString(),
  };
  const [review] = await deps.db
    .insert(conversationReviews)
    .values({
      teamId: row.teamId,
      conversationKey: identity.key,
      source: identity.source,
      status: 'pending',
      lastRawEventId: row.id,
      quietUntil,
      metadata: anchorMetadata,
    })
    .onConflictDoUpdate({
      target: [conversationReviews.teamId, conversationReviews.conversationKey],
      set: {
        status: 'pending',
        lastRawEventId: row.id,
        quietUntil,
        metadata: sql`${conversationReviews.metadata} || ${JSON.stringify(anchorMetadata)}::jsonb`,
        updatedAt: new Date(),
      },
      where: sql`COALESCE(${conversationReviews.metadata} ->> 'review_outcome', '') <> 'superseded_by_thread_review'
        AND (
          COALESCE(
            (SELECT ${rawEvents.occurredAt} FROM ${rawEvents} WHERE ${rawEvents.id} = ${conversationReviews.lastRawEventId}),
            (${conversationReviews.metadata} ->> 'last_anchor_occurred_at')::timestamptz
          ) IS NULL OR (
            COALESCE(
              (SELECT ${rawEvents.occurredAt} FROM ${rawEvents} WHERE ${rawEvents.id} = ${conversationReviews.lastRawEventId}),
              (${conversationReviews.metadata} ->> 'last_anchor_occurred_at')::timestamptz
            ),
            COALESCE(
              ${conversationReviews.lastRawEventId},
              (${conversationReviews.metadata} ->> 'last_anchor_raw_event_id')::uuid
            )
          ) < (${row.occurredAt.toISOString()}::timestamptz, ${row.id}::uuid)
        )`,
    })
    .returning({
      id: conversationReviews.id,
      teamId: conversationReviews.teamId,
      status: conversationReviews.status,
      quietUntil: conversationReviews.quietUntil,
    });
  const scheduledReview =
    review ?? (await loadPendingConversationReview(deps.db, row.teamId, identity.key));
  if (scheduledReview?.status !== 'pending') return;
  const delayMs = Math.max(0, scheduledReview.quietUntil.getTime() - Date.now());
  await (io.enqueueSuggestionJob ?? queue.enqueueSuggestionJob)(
    {
      scope: 'conversation_review',
      conversationReviewId: scheduledReview.id,
      teamId: scheduledReview.teamId,
    },
    { delayMs, jobIdSuffix: scheduledReview.quietUntil.toISOString() },
  );
  await supersedePendingSlackChannelReviewForThreadReply(deps.db, row);
}

async function loadPendingConversationReview(
  db: Db,
  teamId: string,
  conversationKey: string,
): Promise<{
  id: string;
  teamId: string;
  status: string;
  quietUntil: Date;
} | null> {
  const [review] = await db
    .select({
      id: conversationReviews.id,
      teamId: conversationReviews.teamId,
      status: conversationReviews.status,
      quietUntil: conversationReviews.quietUntil,
    })
    .from(conversationReviews)
    .where(
      and(
        eq(conversationReviews.teamId, teamId),
        eq(conversationReviews.conversationKey, conversationKey),
      ),
    )
    .limit(1);
  return review ?? null;
}

async function processConversationReviewJob(
  deps: SuggestionWorkerDeps,
  data: queue.SuggestionConversationReviewJobData,
  io: SuggestionWorkerIO,
  modelVersion: string,
): Promise<void> {
  const rows = await deps.db
    .select({ review: conversationReviews, last: rawEvents })
    .from(conversationReviews)
    .leftJoin(rawEvents, eq(rawEvents.id, conversationReviews.lastRawEventId))
    .where(eq(conversationReviews.id, data.conversationReviewId))
    .limit(1);
  const hit = rows[0];
  if (!hit) {
    throw new UnrecoverableError(`conversation review ${data.conversationReviewId} not found`);
  }
  const review = hit.review;
  const last = hit.last;
  if (review.teamId !== data.teamId) {
    throw new UnrecoverableError(`conversation review ${data.conversationReviewId} team mismatch`);
  }
  if (review.status !== 'pending') return;
  if (!last) {
    await markReviewMissingAnchor(deps.db, review.id);
    return;
  }
  const now = new Date();
  if (review.quietUntil > now) {
    await (io.enqueueSuggestionJob ?? queue.enqueueSuggestionJob)(
      { scope: 'conversation_review', conversationReviewId: review.id, teamId: review.teamId },
      {
        delayMs: review.quietUntil.getTime() - now.getTime(),
        jobIdSuffix: review.quietUntil.toISOString(),
      },
    );
    return;
  }
  if (review.reviewedThroughRawEventId === last.id) return;

  const identity = conversationReview.conversationIdentityForRawEvent(last);
  if (!identity) {
    await markReviewComplete(deps.db, review.id, last, 'identity_missing');
    return;
  }
  const window = await conversationReview.buildConversationEvidenceWindow(deps.db, {
    teamId: review.teamId,
    identity,
    anchorOccurredAt: last.occurredAt,
  });
  if (window.length === 0) {
    await markReviewComplete(deps.db, review.id, last);
    return;
  }
  const linkedContext = await conversationReview.buildLinkedContextWindow(deps.db, {
    teamId: review.teamId,
    identity,
    evidenceWindow: window,
  });
  if (!(await isConversationReviewCurrent(deps.db, review.id, last.id))) return;

  const proposalsCreated = await runSuggestionExtraction(deps, {
    anchor: last,
    teamId: review.teamId,
    modelVersion,
    modelId: io.modelId ?? llm.TIMELINE_MODELS.extraction.id,
    io,
    conversation: { reviewId: review.id, key: review.conversationKey, window, linkedContext },
  });
  await markReviewComplete(
    deps.db,
    review.id,
    last,
    proposalsCreated > 0 ? 'proposal' : 'no_action',
  );
}

async function supersedePendingSlackChannelReviewForThreadReply(
  db: Db,
  row: typeof rawEvents.$inferSelect,
): Promise<void> {
  const thread = conversationReview.slackThreadInfoForRawEvent(row);
  if (!thread) return;

  const channelKey = conversationReview.slackChannelConversationKey({
    teamId: row.teamId,
    workspaceId: thread.workspaceId,
    channelId: thread.channelId,
  });
  const threadKey = `slack:${row.teamId}:${thread.workspaceId}:${thread.channelId}:thread:${thread.threadTs}`;

  await db
    .update(conversationReviews)
    .set({
      status: 'completed',
      metadata: sql`${conversationReviews.metadata} || ${JSON.stringify({
        review_outcome: 'superseded_by_thread_review',
        superseded_by_conversation_key: threadKey,
        reviewed_at: new Date().toISOString(),
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationReviews.teamId, row.teamId),
        eq(conversationReviews.conversationKey, channelKey),
        eq(conversationReviews.status, 'pending'),
        sql`${conversationReviews.lastRawEventId} IN (
          SELECT ${rawEvents.id}
          FROM ${rawEvents}
          WHERE ${rawEvents.teamId} = ${row.teamId}
            AND ${rawEvents.source} = 'slack'
            AND ${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${thread.workspaceId}
            AND ${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${thread.channelId}
            AND ${rawEvents.sourceMetadata} ->> 'slack_thread_ts' IS NULL
            AND (${rawEvents.occurredAt}, ${rawEvents.id}) <= (${row.occurredAt.toISOString()}::timestamptz, ${row.id}::uuid)
        )`,
      ),
    );
}

async function isConversationReviewCurrent(
  db: Db,
  reviewId: string,
  lastRawEventId: string,
): Promise<boolean> {
  const [review] = await db
    .select({ id: conversationReviews.id })
    .from(conversationReviews)
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.status, 'pending'),
        eq(conversationReviews.lastRawEventId, lastRawEventId),
      ),
    )
    .limit(1);
  return Boolean(review);
}

async function markReviewMissingAnchor(db: Db, reviewId: string): Promise<void> {
  await db
    .update(conversationReviews)
    .set({
      status: 'completed',
      metadata: sql`${conversationReviews.metadata} || ${JSON.stringify({
        review_outcome: 'anchor_missing',
        reviewed_at: new Date().toISOString(),
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.status, 'pending'),
        isNull(conversationReviews.lastRawEventId),
      ),
    );
}

async function markReviewComplete(
  db: Db,
  reviewId: string,
  last: typeof rawEvents.$inferSelect,
  outcome = 'no_action',
): Promise<void> {
  await db
    .update(conversationReviews)
    .set({
      status: 'completed',
      reviewedThroughRawEventId: last.id,
      reviewedThroughOccurredAt: last.occurredAt,
      metadata: sql`${conversationReviews.metadata} || ${JSON.stringify({
        review_outcome: outcome,
        reviewed_at: new Date().toISOString(),
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.status, 'pending'),
        eq(conversationReviews.lastRawEventId, last.id),
      ),
    );
}

function buildPrompt(args: {
  text: string;
  occurredAt: Date;
  workspaceTime: time.WorkspaceTimeContext;
  facts: string[];
  members: { userId: string; name: string | null; email: string | null }[];
  objects: { id: string; type: string; name: string; aliases: string[]; status: string }[];
  qnaNotes: {
    id: string;
    entityId: string;
    entityType: string;
    entityName: string;
    body: string;
  }[];
  calendar: { id: string; title: string; startAt: string; allDay: boolean }[];
  recent: { occurredAt: Date; text: string | null }[];
  conversationWindow: conversationReview.ConversationEvidenceEvent[] | null;
  linkedContext: conversationReview.ConversationLinkedContextEvent[];
}): string {
  return [
    `Workspace timezone: ${args.workspaceTime.timezone}`,
    `Current workspace date: ${args.workspaceTime.today}`,
    `Source event occurred at: ${args.occurredAt.toISOString()}`,
    `Use the source event time, not current time, for relative phrases inside the event.`,
    '',
    '# Team members',
    ...args.members.map((m) => `- ${m.userId}: ${m.name ?? 'Unnamed'} <${m.email ?? 'no-email'}>`),
    '',
    '# Existing workspace objects',
    ...args.objects.map(
      (o) =>
        `- ${o.id}: ${o.type} "${o.name}" status=${o.status} aliases=${
          o.aliases.join(', ') || 'none'
        }`,
    ),
    '',
    '# Existing Q&A object notes',
    ...args.qnaNotes.map(
      (note) =>
        `- note:${note.id} object:${note.entityId} ${note.entityType} "${note.entityName}" ${truncate(
          note.body,
          500,
        )}`,
    ),
    '',
    '# Existing calendar events',
    ...args.calendar.map((ev) => `- ${ev.id}: "${ev.title}" ${ev.startAt} all_day=${ev.allDay}`),
    '',
    '# Existing facts from this event',
    ...args.facts.map((f) => `- ${f}`),
    '',
    args.conversationWindow ? '# Conversation evidence window' : '# Recent context',
    ...(args.conversationWindow
      ? args.conversationWindow.map(
          (r) => `- [${r.id} ${r.occurredAt.toISOString()}] ${truncate(r.contentText, 700)}`,
        )
      : args.recent.map((r) => `- [${r.occurredAt.toISOString()}] ${truncate(r.text ?? '', 500)}`)),
    ...(args.conversationWindow
      ? [
          '',
          '# Explicit linked context',
          'Use only for disambiguating object-backed references. Do not create or update proposals from this section unless the conversation evidence window itself supports the proposal.',
          ...args.linkedContext.map(
            (r) =>
              `- [${r.id} ${r.source} ${r.occurredAt.toISOString()} objects=${r.linkedObjects
                .map((object) => `${object.type}:${object.name}`)
                .join(', ')}] ${truncate(r.contentText, 500)}`,
          ),
        ]
      : []),
    '',
    args.conversationWindow ? '# Anchor raw event' : '# Current raw event',
    args.text,
  ].join('\n');
}

export function startSuggestionWorker(deps: SuggestionWorkerDeps): Worker<queue.SuggestionJobData> {
  const worker = new Worker<queue.SuggestionJobData>(
    queue.QUEUE_NAMES.suggestions,
    async (job: Job<queue.SuggestionJobData>) => {
      await processSuggestionJobForTests(deps, job.data);
    },
    { connection: queue.getRedisConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    captureWorkerJobFailure(err, job);
  });
  return worker;
}
