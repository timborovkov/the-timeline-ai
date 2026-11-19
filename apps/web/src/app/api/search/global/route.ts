import { bucketSearchResultCount } from '@timeline/shared/analytics';
import { getEnv } from '@timeline/shared/env';
import { withQdrantOperation } from '@timeline/shared/qdrant';
import * as rateLimit from '@timeline/shared/rate-limit';
import {
  GLOBAL_SEARCH_KINDS,
  finalizeGlobalSearchResult,
  rankGlobalSearchResults,
  scoreIntent,
  scoreLexical,
  scoreRecency,
  searchQuickLinks,
  type GlobalSearchCoverage,
  type GlobalSearchKind,
  type GlobalSearchResult,
  type GlobalSearchWarning,
} from '@timeline/shared/search';
import { assertValidTimezone, localDateFromInstant } from '@timeline/shared/time';
import { taskCategoryLabel } from '@timeline/shared/task-categories/types';
import { withTeam } from '@timeline/shared/team-scope';
import { buildTimelineMoments, timelineMomentAnchorId } from '@timeline/shared/timeline-moments';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { resolveSearchDateBound, searchDateBound, searchDateOnly } from '@/lib/global-search-dates';
import { GLOBAL_SEARCH_SOURCE_VALUES } from '@/lib/global-search-sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  query: z.string().trim().max(500).default(''),
  mode: z.enum(['preview', 'full']).default('preview'),
  kinds: z.array(z.enum(GLOBAL_SEARCH_KINDS)).max(GLOBAL_SEARCH_KINDS.length).optional(),
  source: z
    .union([
      z.enum(GLOBAL_SEARCH_SOURCE_VALUES),
      z.array(z.enum(GLOBAL_SEARCH_SOURCE_VALUES)).max(GLOBAL_SEARCH_SOURCE_VALUES.length),
    ])
    .optional(),
  from: searchDateBound.optional(),
  to: searchDateBound.optional(),
  limit: z.number().int().min(1).max(80).optional(),
});

type Scope = ReturnType<typeof withTeam>;
type ReadyObjectSummary = Awaited<ReturnType<Scope['objects']['listReadyObjectSummaries']>>[number];
type SearchInput = Omit<z.infer<typeof schema>, 'from' | 'to'> &
  SearchRange & {
    calendarDates?: { from?: string; to?: string };
  };
type SearchRange = { from?: Date; to?: Date };
type TimelineRow = Awaited<ReturnType<Scope['timeline']['listEvents']>>[number];

function wants(kinds: Set<GlobalSearchKind> | null, kind: GlobalSearchKind): boolean {
  return !kinds || kinds.has(kind);
}

function textFromMetadata(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function sourceLimit(input: SearchInput, fallback: number): number {
  return Math.min(input.limit ?? fallback, input.mode === 'preview' ? 8 : 30);
}

function searchObjectsAndTasks(
  input: SearchInput,
  rows: Awaited<ReturnType<Scope['objects']['listObjects']>>,
  kinds: Set<GlobalSearchKind> | null,
  summaries: Map<string, ReadyObjectSummary>,
  taskCategoriesEnabled: boolean,
): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];
  for (const row of rows) {
    const kind: GlobalSearchKind =
      row.type === 'task' || row.type === 'follow_up' ? 'task' : 'object';
    if (!wants(kinds, kind)) continue;
    const metadataFields = [
      textFromMetadata(row.metadata.integration_provider),
      textFromMetadata(row.metadata.integration_external_id),
    ];
    const summary = summaries.get(row.id);
    const categoryLabel =
      taskCategoriesEnabled && row.type === 'task' ? taskCategoryLabel(row.taskCategory) : null;
    const lexical = scoreLexical({
      query: input.query,
      title: row.canonicalName,
      fields: [
        row.type,
        row.status,
        row.stage,
        categoryLabel,
        summary?.plainText,
        ...row.aliases,
        ...metadataFields,
      ],
      keywords: [row.type, kind, row.status, categoryLabel].filter((value): value is string =>
        Boolean(value),
      ),
    });
    const intent = scoreIntent(input.query, kind, [row.type, kind, row.status]);
    if (input.query.trim() && !lexical.lexical && !lexical.title && intent === 0) continue;
    results.push(
      finalizeGlobalSearchResult({
        id: `${kind}:${row.id}`,
        kind,
        title: row.canonicalName,
        snippet: summary?.plainText
          ? summary.plainText.slice(0, 240)
          : kind === 'task'
            ? [row.status, row.stage, categoryLabel].filter(Boolean).join(' · ') || 'Task'
            : [row.type, row.status, row.stage].filter(Boolean).join(' · '),
        href: `/app/objects/${row.id}`,
        updatedAt: row.updatedAt.toISOString(),
        scoreParts: {
          ...lexical,
          intent,
          recency: scoreRecency(row.updatedAt),
        },
        metadata: {
          type: row.type,
          status: row.status,
          stage: row.stage,
          dueAt: row.dueAt?.toISOString() ?? null,
          summary: Boolean(summary),
          ...(taskCategoriesEnabled
            ? {
                taskCategory: row.taskCategory,
                taskCategoryStatus: row.taskCategoryStatus,
              }
            : {}),
        },
        pinTarget: { kind: 'object', key: row.id },
      }),
    );
  }
  return rankGlobalSearchResults(results).slice(0, sourceLimit(input, 12));
}

async function searchObjectNotes(
  input: SearchInput,
  scope: Scope,
  existing: GlobalSearchResult[],
  kinds: Set<GlobalSearchKind> | null,
  warnings: GlobalSearchWarning[],
): Promise<GlobalSearchResult[]> {
  if (input.mode !== 'full' || input.query.trim().length < 3) return existing;
  try {
    const notes = await scope.timeline.searchObjectNotes({
      query: input.query,
      limit: 10,
      updatedAfter: input.from,
      updatedBefore: input.to,
      excludeArchived: true,
      useObjectUpdatedAt: true,
      onCandidateLimitReached() {
        warnings.push({
          source: 'object',
          message: 'Object note search reached its candidate limit.',
        });
      },
    });
    const byId = new Map(existing.map((result) => [result.href, result]));
    for (const note of notes) {
      const kind: GlobalSearchKind =
        note.objectType === 'task' || note.objectType === 'follow_up' ? 'task' : 'object';
      if (!wants(kinds, kind)) continue;
      const href = `/app/objects/${note.objectId}`;
      const current = byId.get(href);
      if (current) {
        const { score: _staleScore, ...currentWithoutScore } = current;
        byId.set(
          href,
          finalizeGlobalSearchResult({
            ...currentWithoutScore,
            scoreParts: {
              ...current.scoreParts,
              semantic: Math.max(current.scoreParts.semantic ?? 0, note.score),
            },
          }),
        );
        continue;
      }
      byId.set(
        href,
        finalizeGlobalSearchResult({
          id: `${kind}:note:${note.noteId}`,
          kind,
          title: note.objectName,
          snippet: note.body.slice(0, 220),
          href,
          updatedAt: note.updatedAt,
          scoreParts: {
            semantic: note.score,
            intent: scoreIntent(input.query, kind, [note.objectType, kind]),
          },
          metadata: { type: note.objectType, note: true },
          pinTarget: { kind: 'object', key: note.objectId },
        }),
      );
    }
    return rankGlobalSearchResults(Array.from(byId.values()));
  } catch {
    warnings.push({ source: 'object', message: 'Object note search is temporarily unavailable.' });
    return existing;
  }
}

function timelineResult(input: {
  id: string;
  source: TimelineRow['source'];
  snippet: string;
  occurredAt: string;
  event?: TimelineRow;
  timezone: string;
  scoreParts: GlobalSearchResult['scoreParts'];
  metadata?: GlobalSearchResult['metadata'];
}): GlobalSearchResult {
  const { id, source, snippet, occurredAt, event, timezone, scoreParts, metadata } = input;
  const moment = event ? buildTimelineMoments([event], new Map(), { timezone })[0] : undefined;
  return finalizeGlobalSearchResult({
    id: `timeline:${id}`,
    kind: 'timeline_event',
    title: snippet || `${source} event`,
    snippet,
    href: moment
      ? `/app/timeline?moment=${encodeURIComponent(moment.id)}#${timelineMomentAnchorId(moment.id)}`
      : `/app/timeline?event=${id}`,
    occurredAt,
    scoreParts,
    metadata: { source, ...metadata },
    ...(moment ? { pinTarget: { kind: 'timeline_moment' as const, key: moment.id } } : {}),
  });
}

type EvidenceSearchStatus = 'searched' | 'keyword' | 'unavailable';

async function searchEvidence(
  query: string,
  runSemantic: boolean,
  semanticSearch: () => Promise<GlobalSearchResult[]>,
  keywordSearch: () => Promise<GlobalSearchResult[]>,
): Promise<{ status: EvidenceSearchStatus; results: GlobalSearchResult[] }> {
  if (runSemantic) {
    try {
      return { status: 'searched', results: await semanticSearch() };
    } catch {
      // Fall back independently so another result type can still use semantic search.
    }
  }
  try {
    return { status: query ? 'keyword' : 'searched', results: await keywordSearch() };
  } catch {
    return { status: 'unavailable', results: [] };
  }
}

async function searchTimeline(
  input: SearchInput,
  scope: Scope,
  timezone: string,
  runSemantic: boolean,
  warnings: GlobalSearchWarning[],
  coverage: GlobalSearchCoverage,
): Promise<GlobalSearchResult[]> {
  const limit = sourceLimit(input, 10);
  const sourceList = input.source === undefined ? [] : [input.source].flat();
  const sources = sourceList.length > 0 ? [...new Set(sourceList)] : [undefined];
  const groups = await Promise.all(
    sources.map(async (source) => {
      const filters = { source, from: input.from, to: input.to, limit };
      const group = await searchEvidence(
        input.query,
        runSemantic,
        async () => {
          const hits = await scope.timeline.searchEvents({
            ...filters,
            query: input.query,
            onRanking(info) {
              if (info.candidateLimitReached)
                warnings.push({
                  source: 'timeline_event',
                  message:
                    'Timeline search reached its candidate limit; results are not exhaustive.',
                });
            },
          });
          const rows = await scope.timeline.getEventsByIds(hits.map((hit) => hit.eventId));
          const byId = new Map(rows.map((event) => [event.id, event]));
          return hits.map((hit) =>
            timelineResult({
              id: hit.eventId,
              source: hit.source,
              snippet: hit.snippet,
              occurredAt: hit.occurredAt,
              event: byId.get(hit.eventId),
              timezone,
              scoreParts: {
                semantic: hit.score,
                intent: scoreIntent(input.query, 'timeline_event', [hit.source]),
                evidenceFreshness: hit.ranking?.freshnessBoost ?? 0,
              },
              metadata: {
                entities: hit.entityIds.length,
                facts: hit.factIds.length,
                relatedEvidence: hit.artifactCluster?.canonicalName ?? null,
                relatedEvidenceSignals: hit.artifactCluster?.relatedEvidence.length ?? null,
                relatedEvidenceStatusSources:
                  hit.artifactCluster?.relatedEvidence.filter((evidence) => evidence.authoritative)
                    .length ?? null,
              },
            }),
          );
        },
        async () => {
          const rows = await scope.timeline.listEvents({ ...filters, keyword: input.query });
          return rows.map((event) => {
            const metadata = event.sourceMetadata as Record<string, unknown>;
            const snippet = (event.contentText ?? textFromMetadata(metadata.title) ?? '').slice(
              0,
              240,
            );
            return timelineResult({
              id: event.id,
              source: event.source,
              snippet,
              occurredAt: event.occurredAt.toISOString(),
              event,
              timezone,
              scoreParts: {
                ...scoreLexical({ query: input.query, title: snippet, fields: [event.id] }),
                recency: scoreRecency(event.occurredAt),
              },
            });
          });
        },
      );
      if (group.status === 'unavailable') {
        warnings.push({
          source: 'timeline_event',
          message: source
            ? `Timeline search is temporarily unavailable for ${source}.`
            : 'Timeline search is temporarily unavailable.',
        });
      }
      return group;
    }),
  );
  const statuses = new Set(groups.map((group) => group.status));
  coverage.timeline_event = statuses.size > 1 ? 'partial' : (groups[0]?.status ?? 'unavailable');
  if (statuses.has('keyword') && statuses.size > 1) {
    warnings.push({
      source: 'timeline_event',
      message: 'Some Timeline sources used keyword matching.',
    });
  }
  const results = groups.flatMap((group) => group.results);
  return rankGlobalSearchResults(
    Array.from(new Map(results.map((result) => [result.id, result])).values()),
  ).slice(0, limit);
}

async function searchDocuments(
  input: SearchInput,
  scope: Scope,
  runSemantic: boolean,
  warnings: GlobalSearchWarning[],
  coverage: GlobalSearchCoverage,
): Promise<GlobalSearchResult[]> {
  const filters = { from: input.from, to: input.to, limit: sourceLimit(input, 10) };
  const { status, results } = await searchEvidence(
    input.query,
    runSemantic,
    async () => {
      const page = await scope.documents.searchDocumentChunksPage({
        ...filters,
        query: input.query,
        maxOffset: 80,
      });
      if (page.retrieval?.candidateLimitReached)
        warnings.push({
          source: 'document_chunk',
          message: 'Document search reached its candidate limit; results are not exhaustive.',
        });
      return page.items.map((hit) =>
        finalizeGlobalSearchResult({
          id: `document:${hit.documentChunkId}`,
          kind: 'document_chunk',
          title: hit.documentName,
          snippet: hit.summary ?? hit.text.slice(0, 240),
          href: `/app/documents/${hit.documentId}?version=${String(hit.version)}#chunk-${hit.documentChunkId}`,
          updatedAt: hit.createdAt.toISOString(),
          scoreParts: {
            semantic: hit.score,
            evidenceFreshness: hit.ranking?.freshnessBoost ?? 0,
            intent: scoreIntent(input.query, 'document_chunk', [
              hit.documentName,
              hit.fileKind,
              hit.representationKind,
            ]),
          },
          metadata: {
            version: hit.version,
            fileKind: hit.fileKind,
            page: hit.pageNumber,
          },
          pinTarget: { kind: 'document', key: hit.documentId },
        }),
      );
    },
    async () => {
      const rows = await scope.documents.searchDocumentNames({ ...filters, query: input.query });
      return rows.map((row) =>
        finalizeGlobalSearchResult({
          id: `document:${row.documentId}:name`,
          kind: 'document_chunk',
          title: row.name,
          snippet: row.filename !== row.name ? row.filename : '',
          href: `/app/documents/${row.documentId}?version=${String(row.version)}`,
          updatedAt: row.createdAt.toISOString(),
          scoreParts: {
            ...scoreLexical({
              query: input.query,
              title: row.name,
              fields: [row.filename, row.documentId],
            }),
            recency: scoreRecency(row.createdAt),
          },
          metadata: { version: row.version, fileKind: 'document' },
          pinTarget: { kind: 'document', key: row.documentId },
        }),
      );
    },
  );
  coverage.document_chunk = status;
  if (status === 'unavailable') {
    warnings.push({
      source: 'document_chunk',
      message: 'Document search is temporarily unavailable.',
    });
  }
  return results;
}

function searchBoards(
  input: SearchInput,
  rows: Awaited<ReturnType<Scope['boards']['listBoards']>>,
): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];
  for (const row of rows) {
    const lexical = scoreLexical({
      query: input.query,
      title: row.name,
      fields: [row.purpose, row.templateKind, ...row.recommendedObjectTypes],
      keywords: ['board', row.templateKind],
    });
    const intent = scoreIntent(input.query, 'board', ['board', row.templateKind]);
    if (input.query.trim() && !lexical.lexical && !lexical.title && intent === 0) continue;
    results.push(
      finalizeGlobalSearchResult({
        id: `board:${row.id}`,
        kind: 'board',
        title: row.name,
        snippet:
          row.purpose || `${row.templateKind.replace('_', ' ')} · ${String(row.itemCount)} items`,
        href: `/app/boards/${row.id}`,
        updatedAt: row.updatedAt.toISOString(),
        scoreParts: {
          ...lexical,
          intent,
          recency: scoreRecency(row.updatedAt),
          navigation: row.pinned ? 0.2 : 0,
        },
        metadata: {
          template: row.templateKind,
          items: row.itemCount,
          pinned: row.pinned,
        },
        pinTarget: { kind: 'board', key: row.id },
      }),
    );
  }
  return rankGlobalSearchResults(results).slice(0, sourceLimit(input, 8));
}

async function guardedSearch<T>(
  warnings: GlobalSearchWarning[],
  source: GlobalSearchWarning['source'],
  message: string,
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch {
    warnings.push({ source, message });
    return fallback;
  }
}

async function searchCalendar(
  input: SearchInput,
  scope: Scope,
  timezone: string,
): Promise<GlobalSearchResult[]> {
  const opts: Parameters<Scope['calendar']['listCalendarEvents']>[0] = {
    limit: input.mode === 'preview' ? 80 : 240,
  };
  if (input.from) opts.from = input.from;
  if (input.to) opts.to = input.to;
  if (input.calendarDates) opts.allDayDates = input.calendarDates;
  const rows = await scope.calendar.listCalendarEvents(opts);
  const results: GlobalSearchResult[] = [];
  for (const row of rows) {
    const safeTitle = row.redacted ? 'Busy block' : row.title;
    const lexical = scoreLexical({
      query: input.query,
      title: safeTitle,
      fields: row.redacted
        ? [row.showAs]
        : [row.description, row.location, row.source, row.timezone],
      keywords: ['calendar', 'meeting', row.source],
    });
    const intent = scoreIntent(input.query, 'calendar_event', ['calendar', 'meeting', row.source]);
    if (input.query.trim() && !lexical.lexical && !lexical.title && intent === 0) continue;
    const eventTimezone = row.allDay ? assertValidTimezone(row.timezone) : timezone;
    const date = localDateFromInstant(row.startAt.toISOString(), eventTimezone);
    results.push(
      finalizeGlobalSearchResult({
        id: `calendar:${row.id}`,
        kind: 'calendar_event',
        title: safeTitle,
        snippet: row.redacted
          ? `${date} · private busy block`
          : [date, row.location, row.description].filter(Boolean).join(' · '),
        href: `/app/calendar?date=${date}&view=day&event=${row.id}`,
        startAt: row.startAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        scoreParts: {
          ...lexical,
          intent,
          recency: scoreRecency(row.startAt),
        },
        metadata: {
          source: row.source,
          allDay: row.allDay,
          allDayDate: row.allDay ? date : null,
          redacted: row.redacted,
        },
        ...(row.redacted
          ? {}
          : {
              pinTarget: {
                kind: 'calendar_event' as const,
                key: row.recurringParentId ?? row.id,
              },
            }),
      }),
    );
  }
  return rankGlobalSearchResults(results).slice(0, sourceLimit(input, 8));
}

export function POST(req: Request): Promise<Response> {
  return withQdrantOperation({ signal: req.signal }, () => searchResponse(req));
}

async function searchResponse(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('search', 'user', session.user.id),
    ...rateLimit.RATE_LIMITS.search,
  });
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_input' },
      { status: 400 },
    );
  }
  const { from, to, ...request } = parsed.data;
  const { query } = request;
  const kinds = request.kinds ? new Set(request.kinds) : null;

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) {
    return Response.json({ ok: false, error: 'no_active_team' }, { status: 400 });
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const includeAdmin = role === 'owner' || role === 'admin';
  const warnings: GlobalSearchWarning[] = [];
  const coverage: GlobalSearchCoverage = {};
  const hasContentCriteria = Boolean(query || from || to || request.source || kinds?.size);
  const calendarDates = {
    ...(searchDateOnly.safeParse(from).success ? { from } : {}),
    ...(searchDateOnly.safeParse(to).success ? { to } : {}),
  };
  const hasDateOnly = Boolean(calendarDates.from || calendarDates.to);
  const needsTimezone =
    hasDateOnly ||
    wants(kinds, 'calendar_event') ||
    (hasContentCriteria && wants(kinds, 'timeline_event'));
  const timezone = needsTimezone
    ? (await scope.calendar.getCalendarSettings()).defaultTimezone
    : 'UTC';
  const range = {
    from: resolveSearchDateBound(from, 'from', timezone),
    to: resolveSearchDateBound(to, 'to', timezone),
  };
  if (range.from && range.to && range.from >= range.to) {
    return Response.json(
      { ok: false, error: 'End date must be on or after the start date.' },
      { status: 400 },
    );
  }
  const input: SearchInput = {
    ...request,
    ...range,
    ...(hasDateOnly ? { calendarDates } : {}),
  };
  const objectRange = { updatedAfter: input.from, updatedBefore: input.to };

  const env = getEnv();
  const semanticReady = Boolean(env.OPENROUTER_API_KEY && env.QDRANT_URL);
  const runSemantic = semanticReady && query.length >= 3;
  const wantsObjectsOrTasks = wants(kinds, 'object') || wants(kinds, 'task');

  const quickLinks = searchQuickLinks({
    query,
    kinds: input.kinds,
    includeAdmin,
    limit: input.mode === 'preview' ? 8 : 20,
  });

  const [objectRows, summaryObjectRows, boardRows, calendarRows, timelineRows, documentRows] =
    await Promise.all([
      wantsObjectsOrTasks
        ? guardedSearch(
            warnings,
            'object',
            'Object search is temporarily unavailable.',
            null,
            () =>
              query
                ? scope.objects.searchObjects({
                    query,
                    archived: false,
                    ...objectRange,
                    limit: sourceLimit(input, 30) * 10,
                  })
                : scope.objects.listObjects({
                    archived: false,
                    ...objectRange,
                    limit: sourceLimit(input, 30) * 10,
                  }),
          )
        : Promise.resolve([]),
      wantsObjectsOrTasks && query
        ? guardedSearch(
            warnings,
            'object',
            'Object summary search is temporarily unavailable.',
            null,
            () =>
              scope.objects.searchObjectsBySummary({
                query,
                archived: false,
                ...objectRange,
                limit: sourceLimit(input, 30) * 10,
              }),
          )
        : Promise.resolve([]),
      wants(kinds, 'board')
        ? guardedSearch(warnings, 'board', 'Board search is temporarily unavailable.', null, () =>
            scope.boards.listBoards(range),
          )
        : Promise.resolve([]),
      wants(kinds, 'calendar_event')
        ? guardedSearch(
            warnings,
            'calendar_event',
            'Calendar search is temporarily unavailable.',
            null,
            () => searchCalendar(input, scope, timezone),
          )
        : Promise.resolve([]),
      hasContentCriteria && wants(kinds, 'timeline_event')
        ? searchTimeline(input, scope, timezone, runSemantic, warnings, coverage)
        : Promise.resolve([]),
      hasContentCriteria && wants(kinds, 'document_chunk')
        ? searchDocuments(input, scope, runSemantic, warnings, coverage)
        : Promise.resolve([]),
    ]);
  const mergedObjectRows = Array.from(
    new Map(
      [...(objectRows ?? []), ...(summaryObjectRows ?? [])].map((row) => [row.id, row]),
    ).values(),
  );

  const summaries =
    mergedObjectRows.length > 0
      ? await guardedSearch(
          warnings,
          'object',
          'Object summaries are temporarily unavailable.',
          [],
          () => scope.objects.listReadyObjectSummaries(mergedObjectRows.map((row) => row.id)),
        )
      : [];
  const objectSummaries = new Map(summaries.map((summary) => [summary.entityId, summary]));
  const lexicalObjectRows = searchObjectsAndTasks(
    { ...input, query },
    mergedObjectRows,
    kinds,
    objectSummaries,
    env.TASK_CATEGORY_UI_ENABLED,
  );
  const objectResults =
    runSemantic && wantsObjectsOrTasks
      ? await searchObjectNotes({ ...input, query }, scope, lexicalObjectRows, kinds, warnings)
      : lexicalObjectRows;
  const boardResults = searchBoards(input, boardRows ?? []);
  if (wants(kinds, 'board')) coverage.board = boardRows ? 'searched' : 'unavailable';
  if (wants(kinds, 'calendar_event'))
    coverage.calendar_event = calendarRows ? 'searched' : 'unavailable';
  if (wants(kinds, 'quick_link')) coverage.quick_link = 'searched';
  if (wants(kinds, 'external_link')) coverage.external_link = 'searched';

  if (wantsObjectsOrTasks) {
    const objectWarnings = warnings.some((warning) => warning.source === 'object');
    const lexicalAvailable = objectRows !== null || (Boolean(query) && summaryObjectRows !== null);
    const status = objectWarnings
      ? lexicalAvailable || objectResults.length > 0
        ? 'partial'
        : 'unavailable'
      : 'searched';
    if (wants(kinds, 'object')) coverage.object = status;
    if (wants(kinds, 'task')) coverage.task = status;
  }
  const limit = input.limit ?? (input.mode === 'preview' ? 12 : 50);
  const results = rankGlobalSearchResults([
    ...quickLinks,
    ...objectResults,
    ...boardResults,
    ...(calendarRows ?? []),
    ...timelineRows,
    ...documentRows,
  ]).slice(0, limit);
  const pinState = await scope.pins.isPinnedMany(
    results.flatMap((result) => (result.pinTarget ? [result.pinTarget] : [])),
  );
  const normalizedResults = results.map((result) =>
    result.pinTarget
      ? {
          ...result,
          pinned: pinState[`${result.pinTarget.kind}:${result.pinTarget.key}`] ?? false,
        }
      : result,
  );

  trackProductEventBestEffort(
    { kind: 'user', userId: session.user.id, teamId: active.teamId },
    'search_performed',
    {
      surface: 'global',
      hasFilters: [input.kinds?.length, input.source, input.from, input.to].some(Boolean),
      resultCountBucket: bucketSearchResultCount(normalizedResults.length),
    },
  );

  return Response.json({
    ok: true,
    query,
    mode: input.mode,
    results: normalizedResults,
    warnings,
    coverage,
  });
}
