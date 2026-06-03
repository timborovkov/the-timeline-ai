import {
  conversationReviews,
  entities,
  facts as factsTable,
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
  enqueueSuggestionJob?: typeof queue.enqueueSuggestionJob;
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
      'Extract proposed workspace changes from natural team conversation. Return only commitments that imply future work, deadlines, scheduled obligations, object updates, or calendar refinements. Do not invent. Use proposal rows only; never claim changes are applied. Return no bundles when the evidence is ambiguous, contradicted, or merely conversational. For date-only scheduled commitments, create all-day calendar_event items. Use UUIDs only from the prompt when targeting existing records.',
    prompt,
  });

  const bundles =
    result.object.bundles.length > 0
      ? result.object.bundles
      : args.conversation
        ? []
        : fallbackBundles({
            text,
            timezone: settings.defaultTimezone,
            occurredAt: row.occurredAt,
            authorUserId: activeAuthorUserId,
          });

  let proposalsCreated = 0;
  for (const bundle of bundles) {
    if (bundle.items.length === 0) continue;
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
          item: args.conversation ? null : item,
        }),
        proposedPayload: item.proposedPayload,
      })),
    });
    proposalsCreated += 1;
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
  const [review] = await deps.db
    .insert(conversationReviews)
    .values({
      teamId: row.teamId,
      conversationKey: identity.key,
      source: identity.source,
      status: 'pending',
      lastRawEventId: row.id,
      quietUntil,
      metadata: { kind: identity.kind },
    })
    .onConflictDoUpdate({
      target: [conversationReviews.teamId, conversationReviews.conversationKey],
      set: {
        status: 'pending',
        lastRawEventId: row.id,
        quietUntil,
        metadata: sql`${conversationReviews.metadata} || ${JSON.stringify({ kind: identity.kind })}::jsonb`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: conversationReviews.id, teamId: conversationReviews.teamId });
  if (!review) throw new Error('failed to schedule conversation review');
  const delayMs = Math.max(0, quietUntil.getTime() - Date.now());
  await (io.enqueueSuggestionJob ?? queue.enqueueSuggestionJob)(
    { scope: 'conversation_review', conversationReviewId: review.id, teamId: review.teamId },
    { delayMs, jobIdSuffix: quietUntil.toISOString() },
  );
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
  if (!last) return;
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
  if (!identity) return;
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
    .where(eq(conversationReviews.id, reviewId));
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
    '# Existing objects/tasks',
    ...args.objects.map((o) => `- ${o.id}: ${o.type} "${o.name}" status=${o.status}`),
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
  return new Worker<queue.SuggestionJobData>(
    queue.QUEUE_NAMES.suggestions,
    async (job: Job<queue.SuggestionJobData>) => {
      await processSuggestionJobForTests(deps, job.data);
    },
    { connection: queue.getRedisConnection(), concurrency: 1 },
  );
}
