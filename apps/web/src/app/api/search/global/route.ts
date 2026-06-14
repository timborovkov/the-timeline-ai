import { getEnv } from '@timeline/shared/env';
import * as rateLimit from '@timeline/shared/rate-limit';
import {
  GLOBAL_SEARCH_KINDS,
  finalizeGlobalSearchResult,
  rankGlobalSearchResults,
  scoreIntent,
  scoreLexical,
  scoreRecency,
  searchQuickLinks,
  type GlobalSearchKind,
  type GlobalSearchResult,
  type GlobalSearchWarning,
} from '@timeline/shared/search';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVENT_SOURCES = [
  'web',
  'telegram',
  'email',
  'system',
  'document',
  'meeting',
  'integration',
  'calendar',
  'slack',
] as const;

const schema = z.object({
  query: z.string().trim().max(500).default(''),
  mode: z.enum(['preview', 'full']).default('preview'),
  kinds: z.array(z.enum(GLOBAL_SEARCH_KINDS)).max(GLOBAL_SEARCH_KINDS.length).optional(),
  source: z.enum(EVENT_SOURCES).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(80).optional(),
});

type Scope = ReturnType<typeof withTeam>;
type Parsed = z.infer<typeof schema>;

function wants(kinds: Set<GlobalSearchKind> | null, kind: GlobalSearchKind): boolean {
  return !kinds || kinds.has(kind);
}

function textFromMetadata(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function sourceLimit(input: Parsed, fallback: number): number {
  return Math.min(input.limit ?? fallback, input.mode === 'preview' ? 8 : 30);
}

function searchObjectsAndTasks(
  input: Parsed,
  rows: Awaited<ReturnType<Scope['objects']['listObjects']>>,
  kinds: Set<GlobalSearchKind> | null,
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
    const lexical = scoreLexical({
      query: input.query,
      title: row.canonicalName,
      fields: [row.type, row.status, row.stage, ...row.aliases, ...metadataFields],
      keywords: [row.type, kind, row.status],
    });
    const intent = scoreIntent(input.query, kind, [row.type, kind, row.status]);
    if (input.query.trim() && !lexical.lexical && !lexical.title && intent === 0) continue;
    results.push(
      finalizeGlobalSearchResult({
        id: `${kind}:${row.id}`,
        kind,
        title: row.canonicalName,
        snippet:
          kind === 'task'
            ? [
                row.status,
                row.stage,
                row.dueAt ? `due ${row.dueAt.toISOString().slice(0, 10)}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Task'
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
        },
      }),
    );
  }
  return rankGlobalSearchResults(results).slice(0, sourceLimit(input, 12));
}

async function searchObjectNotes(
  input: Parsed,
  scope: Scope,
  existing: GlobalSearchResult[],
  kinds: Set<GlobalSearchKind> | null,
  warnings: GlobalSearchWarning[],
): Promise<GlobalSearchResult[]> {
  if (input.mode !== 'full' || input.query.trim().length < 3) return existing;
  try {
    const notes = await scope.timeline.searchObjectNotes({ query: input.query, limit: 10 });
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
        }),
      );
    }
    return rankGlobalSearchResults(Array.from(byId.values()));
  } catch {
    warnings.push({ source: 'object', message: 'Object note search is temporarily unavailable.' });
    return existing;
  }
}

async function searchTimeline(
  input: Parsed,
  scope: Scope,
  warnings: GlobalSearchWarning[],
): Promise<GlobalSearchResult[]> {
  try {
    const args: Parameters<Scope['timeline']['searchEvents']>[0] = {
      query: input.query,
      limit: sourceLimit(input, 10),
    };
    if (input.from) args.from = new Date(input.from);
    if (input.to) args.to = new Date(input.to);
    if (input.source) args.source = input.source;
    const hits = await scope.timeline.searchEvents(args);
    return hits.map((hit) =>
      finalizeGlobalSearchResult({
        id: `timeline:${hit.eventId}`,
        kind: 'timeline_event',
        title: hit.snippet || `${hit.source} event`,
        snippet: hit.snippet,
        href: `/app/timeline?event=${hit.eventId}`,
        occurredAt: hit.occurredAt,
        scoreParts: {
          semantic: hit.score,
          intent: scoreIntent(input.query, 'timeline_event', [hit.source]),
          recency: scoreRecency(hit.occurredAt),
        },
        metadata: {
          source: hit.source,
          entities: hit.entityIds.length,
          facts: hit.factIds.length,
        },
      }),
    );
  } catch {
    warnings.push({
      source: 'timeline_event',
      message: 'Timeline search is temporarily unavailable.',
    });
    return [];
  }
}

async function searchDocuments(
  input: Parsed,
  scope: Scope,
  warnings: GlobalSearchWarning[],
): Promise<GlobalSearchResult[]> {
  try {
    const page = await scope.documents.searchDocumentChunksPage({
      query: input.query,
      limit: sourceLimit(input, 10),
      maxOffset: 80,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
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
      }),
    );
  } catch {
    warnings.push({
      source: 'document_chunk',
      message: 'Document search is temporarily unavailable.',
    });
    return [];
  }
}

function searchBoards(
  input: Parsed,
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

async function searchCalendar(input: Parsed, scope: Scope): Promise<GlobalSearchResult[]> {
  const opts: Parameters<Scope['calendar']['listCalendarEvents']>[0] = {
    limit: input.mode === 'preview' ? 80 : 240,
  };
  if (input.from) opts.from = new Date(input.from);
  if (input.to) opts.to = new Date(input.to);
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
    const date = row.startAt.toISOString().slice(0, 10);
    results.push(
      finalizeGlobalSearchResult({
        id: `calendar:${row.id}`,
        kind: 'calendar_event',
        title: safeTitle,
        snippet: row.redacted
          ? `${date} · private busy block`
          : [date, row.location, row.description].filter(Boolean).join(' · '),
        href: `/app/calendar?date=${date}&view=day`,
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
          redacted: row.redacted,
        },
      }),
    );
  }
  return rankGlobalSearchResults(results).slice(0, sourceLimit(input, 8));
}

export async function POST(req: Request): Promise<Response> {
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
  const input = parsed.data;
  const query = input.query.trim();
  const kinds = input.kinds ? new Set(input.kinds) : null;

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) {
    return Response.json({ ok: false, error: 'no_active_team' }, { status: 400 });
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const includeAdmin = role === 'owner' || role === 'admin';
  const warnings: GlobalSearchWarning[] = [];

  const env = getEnv();
  const semanticReady = Boolean(env.OPENROUTER_API_KEY && env.QDRANT_URL);
  const runSemantic = semanticReady && query.length >= 3;
  const wantsObjectsOrTasks = wants(kinds, 'object') || wants(kinds, 'task');
  if (!semanticReady && query.length >= 3) {
    warnings.push({ source: 'semantic', message: 'Semantic search is not configured.' });
  }

  const quickLinks = searchQuickLinks({
    query,
    kinds: input.kinds,
    includeAdmin,
    limit: input.mode === 'preview' ? 8 : 20,
  });

  const [objectRows, boardRows, calendarRows, timelineRows, documentRows] = await Promise.all([
    wantsObjectsOrTasks
      ? guardedSearch(warnings, 'object', 'Object search is temporarily unavailable.', [], () =>
          scope.objects.listObjects({ archived: false, limit: 500 }),
        )
      : Promise.resolve([]),
    wants(kinds, 'board')
      ? guardedSearch(warnings, 'board', 'Board search is temporarily unavailable.', [], () =>
          scope.boards.listBoards(),
        )
      : Promise.resolve([]),
    wants(kinds, 'calendar_event')
      ? guardedSearch(
          warnings,
          'calendar_event',
          'Calendar search is temporarily unavailable.',
          [],
          () => searchCalendar({ ...input, query }, scope),
        )
      : Promise.resolve([]),
    runSemantic && wants(kinds, 'timeline_event')
      ? searchTimeline({ ...input, query }, scope, warnings)
      : Promise.resolve([]),
    runSemantic && wants(kinds, 'document_chunk')
      ? searchDocuments({ ...input, query }, scope, warnings)
      : Promise.resolve([]),
  ]);

  const lexicalObjectRows = searchObjectsAndTasks({ ...input, query }, objectRows, kinds);
  const objectResults =
    runSemantic && wantsObjectsOrTasks
      ? await searchObjectNotes({ ...input, query }, scope, lexicalObjectRows, kinds, warnings)
      : lexicalObjectRows;
  const boardResults = searchBoards({ ...input, query }, boardRows);
  const limit = input.limit ?? (input.mode === 'preview' ? 12 : 50);
  const results = rankGlobalSearchResults([
    ...quickLinks,
    ...objectResults,
    ...boardResults,
    ...calendarRows,
    ...timelineRows,
    ...documentRows,
  ]).slice(0, limit);

  return Response.json({
    ok: true,
    query,
    mode: input.mode,
    results,
    warnings,
  });
}
