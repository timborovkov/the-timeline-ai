import {
  entities,
  facts as factsTable,
  rawEvents,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { getEnv, llm, queue, suggestions, time, withTeam } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const SUGGESTION_CODE_VERSION = '2026-05-a';
const RECENT_CONTEXT_LIMIT = 5;
const CALENDAR_CONTEXT_PAST_DAYS = 30;
const CALENDAR_CONTEXT_FUTURE_DAYS = 180;
const NEXT_WEEKDAY_PATTERN =
  'monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun';
const COMMITMENT_TIME_PATTERN = new RegExp(
  `\\b(?:i'll|i will)\\s+(.+)\\s+(tomorrow|next\\s+(?:${NEXT_WEEKDAY_PATTERN}))\\b`,
  'i',
);

interface SuggestionWorkerDeps {
  db: Db;
}

interface SuggestionWorkerIO {
  getEnv?: typeof getEnv;
  chatStructured?: typeof llm.chatStructured;
  modelId?: string;
}

const suggestionItemSchema = z.object({
  operation: z.enum(['create', 'update', 'archive_or_cancel']),
  targetKind: z.enum(['task', 'object', 'calendar_event']),
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

function makeModelVersion(modelId: string): string {
  return `${modelId}@${SUGGESTION_CODE_VERSION}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
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
  const match = COMMITMENT_TIME_PATTERN.exec(text);
  if (!match) return [];
  const action = commitmentActionBeforeTimePhrase(match[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const phrase = match[2] ?? 'tomorrow';
  if (!action) return [];
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
  return [
    {
      title: `Commitment: ${String(taskPayload.canonicalName)}`,
      summary: truncate(text, 500),
      reason: 'A team member said they would do this work.',
      confidence: 'medium',
      quote: truncate(text, 500),
      items,
    },
  ];
}

export async function processSuggestionJobForTests(
  deps: SuggestionWorkerDeps,
  data: queue.SuggestionJobData,
  io: SuggestionWorkerIO = {},
): Promise<void> {
  const { rawEventId, teamId } = data;
  const env = (io.getEnv ?? getEnv)();
  if (!env.OPENROUTER_API_KEY) {
    throw new UnrecoverableError('suggestions: OPENROUTER_API_KEY not configured');
  }
  const modelId = io.modelId ?? llm.TIMELINE_MODELS.extraction.id;
  const modelVersion = makeModelVersion(modelId);

  const rows = await deps.db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`raw event ${rawEventId} not found`);
  if (row.teamId !== teamId) throw new UnrecoverableError(`raw event ${rawEventId} team mismatch`);
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
    return;
  }
  if (meta.suggestion_model_version === modelVersion) return;

  const hasSettledExtraction = extractionSettled(meta);
  if (!hasSettledExtraction && meta.suggestion_pre_extract_model_version === modelVersion) return;

  const factRows = await deps.db
    .select({ statement: factsTable.statement })
    .from(factsTable)
    .where(eq(factsTable.rawEventId, rawEventId))
    .limit(20);

  const entityRows = await deps.db
    .select({
      id: entities.id,
      type: entities.type,
      name: entities.canonicalName,
      status: entities.status,
    })
    .from(entities)
    .where(and(eq(entities.teamId, teamId), isNull(entities.mergedIntoId)))
    .orderBy(desc(entities.updatedAt))
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
        status: e.status,
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
    }),
    llm.inputTokenBudgetFor(llm.TIMELINE_MODELS.extraction),
  );

  const chatStructured = io.chatStructured ?? llm.chatStructured;
  const result = await chatStructured({
    schema: suggestionExtractionSchema,
    model: modelId,
    system:
      'Extract proposed workspace changes from natural team conversation. Return only commitments that imply future work, deadlines, scheduled obligations, object updates, or calendar refinements. Do not invent. Use proposal rows only; never claim changes are applied. For date-only scheduled commitments, create all-day calendar_event items. Use UUIDs only from the prompt when targeting existing records.',
    prompt,
  });

  const bundles =
    result.object.bundles.length > 0
      ? result.object.bundles
      : fallbackBundles({
          text,
          timezone: settings.defaultTimezone,
          occurredAt: row.occurredAt,
          authorUserId: activeAuthorUserId,
        });

  for (const bundle of bundles) {
    if (bundle.items.length === 0) continue;
    const bundleDedupe = suggestions.suggestionDedupeKey({
      rawEventId,
      title: bundle.title,
      items: bundle.items,
    });
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: bundle.title,
      summary: bundle.summary ?? null,
      reason: bundle.reason ?? null,
      confidence: bundle.confidence,
      dedupeKey: bundleDedupe,
      visibility: row.visibility,
      visibilityOwnerUserId: null,
      visibilityUserIds: null,
      evidence: [{ rawEventId, quote: bundle.quote ?? truncate(text, 500) }],
      metadata: { suggestion_model_version: modelVersion },
      items: bundle.items.map((item, index) => ({
        operation: item.operation,
        targetKind: item.targetKind,
        targetId: item.targetId ?? null,
        title: item.title,
        description: item.description ?? null,
        dedupeKey: suggestions.suggestionDedupeKey({
          rawEventId,
          bundleDedupe,
          index,
          item,
        }),
        proposedPayload: item.proposedPayload,
      })),
    });
  }

  await stampSuggestionMetadata(
    deps.db,
    rawEventId,
    hasSettledExtraction
      ? {
          suggestion_model_version: modelVersion,
          suggestions_extracted_at: new Date().toISOString(),
        }
      : {
          suggestion_pre_extract_model_version: modelVersion,
          suggestions_pre_extracted_at: new Date().toISOString(),
        },
  );
}

function buildPrompt(args: {
  text: string;
  occurredAt: Date;
  workspaceTime: time.WorkspaceTimeContext;
  facts: string[];
  members: { userId: string; name: string | null; email: string | null }[];
  objects: { id: string; type: string; name: string; status: string }[];
  calendar: { id: string; title: string; startAt: string; allDay: boolean }[];
  recent: { occurredAt: Date; text: string | null }[];
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
    '# Existing objects/tasks',
    ...args.objects.map((o) => `- ${o.id}: ${o.type} "${o.name}" status=${o.status}`),
    '',
    '# Existing calendar events',
    ...args.calendar.map((ev) => `- ${ev.id}: "${ev.title}" ${ev.startAt} all_day=${ev.allDay}`),
    '',
    '# Existing facts from this event',
    ...args.facts.map((f) => `- ${f}`),
    '',
    '# Recent context',
    ...args.recent.map((r) => `- [${r.occurredAt.toISOString()}] ${truncate(r.text ?? '', 500)}`),
    '',
    '# Current raw event',
    args.text,
  ].join('\n');
}

export function startSuggestionWorker(deps: SuggestionWorkerDeps): Worker<queue.SuggestionJobData> {
  return new Worker<queue.SuggestionJobData>(
    queue.QUEUE_NAMES.suggestions,
    async (job: Job<queue.SuggestionJobData>) => {
      await processSuggestionJobForTests(deps, job.data);
    },
    { connection: queue.getRedisConnection(), concurrency: 1 },
  );
}
