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

interface SuggestionWorkerDeps {
  db: Db;
}

const suggestionItemSchema = z.object({
  operation: z.enum(['create', 'update', 'archive_or_cancel']),
  targetKind: z.enum(['task', 'object', 'calendar_event']),
  targetId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  proposedPayload: z.record(z.unknown()),
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

function firstSentence(s: string): string {
  return s.split(/[.!?\n]/)[0]?.trim() ?? s.trim();
}

function fallbackBundles(args: {
  text: string;
  timezone: string;
  occurredAt: Date;
  authorUserId: string | null;
}): SuggestionBundleOutput[] {
  const text = args.text.trim();
  const match = /\b(?:i'll|i will)\s+(.+?)\s+(tomorrow|next\s+\w+)\b/i.exec(text);
  if (!match) return [];
  const action = firstSentence(match[1] ?? '')
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
      const { rawEventId, teamId } = job.data;
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY) {
        throw new UnrecoverableError('suggestions: OPENROUTER_API_KEY not configured');
      }
      const modelId = env.EXTRACTION_MODEL ?? env.CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini';
      const modelVersion = makeModelVersion(modelId);

      const rows = await deps.db
        .select()
        .from(rawEvents)
        .where(eq(rawEvents.id, rawEventId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new UnrecoverableError(`raw event ${rawEventId} not found`);
      if (row.teamId !== teamId)
        throw new UnrecoverableError(`raw event ${rawEventId} team mismatch`);
      const text = row.contentText?.trim();
      if (!text) throw new UnrecoverableError(`raw event ${rawEventId} has no content_text`);

      const meta =
        row.sourceMetadata && typeof row.sourceMetadata === 'object'
          ? (row.sourceMetadata as Record<string, unknown>)
          : {};
      if (meta.suggestion_model_version === modelVersion) return;

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
      const activeMemberIds = new Set(memberRows.map((member) => member.userId));
      const activeVisibilityUserIds = (row.visibilityUserIds ?? []).filter((uid) =>
        activeMemberIds.has(uid),
      );
      let scopeUserId = PSEUDO_USER;
      let visibilityOwnerUserId: string | null = null;
      let visibilityUserIds: string[] | null = null;

      if (row.visibility === 'private') {
        if (!activeAuthorUserId) {
          await deps.db
            .update(rawEvents)
            .set({
              sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${JSON.stringify(
                {
                  suggestions_skipped_at: new Date().toISOString(),
                  suggestions_skipped_reason: 'private_author_not_active',
                  suggestion_model_version: modelVersion,
                },
              )}::jsonb`,
            })
            .where(eq(rawEvents.id, rawEventId));
          return;
        }
        scopeUserId = activeAuthorUserId;
        visibilityOwnerUserId = activeAuthorUserId;
      } else if (row.visibility === 'specific_users') {
        if (activeVisibilityUserIds.length === 0) {
          await deps.db
            .update(rawEvents)
            .set({
              sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${JSON.stringify(
                {
                  suggestions_skipped_at: new Date().toISOString(),
                  suggestions_skipped_reason: 'specific_users_empty',
                  suggestion_model_version: modelVersion,
                },
              )}::jsonb`,
            })
            .where(eq(rawEvents.id, rawEventId));
          return;
        }
        scopeUserId =
          activeAuthorUserId && activeVisibilityUserIds.includes(activeAuthorUserId)
            ? activeAuthorUserId
            : (activeVisibilityUserIds[0] ?? PSEUDO_USER);
        visibilityUserIds = activeVisibilityUserIds;
      }

      const scope = withTeam(deps.db, teamId, scopeUserId, {
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

      const calendarRows = await scope.calendar.listCalendarEvents({ limit: 40 });

      const prompt = buildPrompt({
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
      });

      const result = await llm.chatStructured({
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
          visibilityOwnerUserId,
          visibilityUserIds,
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

      await deps.db
        .update(rawEvents)
        .set({
          sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${JSON.stringify(
            {
              suggestion_model_version: modelVersion,
              suggestions_extracted_at: new Date().toISOString(),
            },
          )}::jsonb`,
        })
        .where(eq(rawEvents.id, rawEventId));
    },
    { connection: queue.getRedisConnection(), concurrency: 1 },
  );
}
