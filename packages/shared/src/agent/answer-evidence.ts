import { z } from 'zod';

import { artifactRefCitation } from '#src/citation.js';

const sourceLabels = {
  timeline: 'Timeline',
  web: 'Web captures',
  document: 'Documents',
  slack: 'Slack',
  telegram: 'Telegram',
  email: 'Email',
  meeting: 'Meetings',
  website: 'Websites',
  ingest_webhook: 'Ingest webhooks',
  integration: 'Connected sources',
  google_drive: 'Google Drive',
  linear: 'Linear',
  github: 'GitHub',
  monday: 'Monday',
  sentry: 'Sentry',
  documents: 'Documents',
  notes: 'Notes',
  objects: 'Workspace records',
  boards: 'Boards',
  calendar: 'Calendar',
  approvals: 'Pending approvals',
} as const;

type Source = keyof typeof sourceLabels;

export const answerEvidenceSchema = z.array(
  z.object({
    source: z.custom<Source>(
      (value) => typeof value === 'string' && Object.hasOwn(sourceLabels, value),
    ),
    status: z.enum(['queried', 'unavailable', 'indexing']),
    latest: z
      .object({
        date: z.string().nullable(),
        basis: z.enum(['source', 'observed', 'uploaded', 'unknown']),
        version: z.number().nullable(),
        citation: z.string().nullable(),
      })
      .nullable(),
  }),
);

export type AnswerEvidence = z.infer<typeof answerEvidenceSchema>;
type EvidenceItem = AnswerEvidence[number];
type Latest = NonNullable<EvidenceItem['latest']>;

export function answerEvidenceSourceLabel(source: Source) {
  return sourceLabels[source];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function knownSource(input: unknown, fallback: Source): Source {
  return typeof input === 'string' && Object.hasOwn(sourceLabels, input)
    ? (input as Source)
    : fallback;
}

function readDate(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestFromResult(row: Record<string, unknown>): Latest | null {
  const ranking = record(row.ranking);
  const rankedDate = readDate(ranking.evidenceDate);
  const date = rankedDate ?? readDate(row.occurred_at ?? row.occurredAt ?? row.created_at);
  const basis =
    rankedDate && ['source', 'observed', 'uploaded', 'unknown'].includes(String(ranking.dateBasis))
      ? (ranking.dateBasis as Latest['basis'])
      : 'unknown';
  const citation =
    typeof row.citation === 'string'
      ? row.citation
      : typeof row.event_id === 'string'
        ? artifactRefCitation({ kind: 'timeline_event', id: row.event_id })
        : null;
  const version =
    typeof row.version === 'number'
      ? row.version
      : Number(citation?.match(/#v(\d+)(?:[:\]])/)?.[1]) || null;
  return date || version ? { date, basis, version, citation } : null;
}

function newer(a: Latest | null, b: Latest | null): Latest | null {
  if (!a) return b;
  if (!b) return a;
  return (b.date ?? '') > (a.date ?? '') ? b : a;
}

function latest(rows: Record<string, unknown>[]): Latest | null {
  return rows.reduce<Latest | null>((value, row) => newer(value, latestFromResult(row)), null);
}

const sourcesForTools: Record<string, Source> = {
  search_timeline: 'timeline',
  search_timeline_moments: 'timeline',
  get_timeline_moment: 'timeline',
  get_event: 'timeline',
  list_events: 'timeline',
  search_integration_events: 'integration',
  get_integration_resource: 'integration',
  search_documents: 'documents',
  search_documents_structured: 'documents',
  get_document: 'documents',
  get_document_chunk: 'documents',
  list_recent_document_changes: 'documents',
  search_object_notes: 'notes',
  search_objects: 'objects',
  get_object: 'objects',
  list_objects: 'objects',
  list_tasks: 'objects',
  search_boards: 'boards',
  list_calendar_events: 'calendar',
  get_calendar_event: 'calendar',
  list_pending_approvals: 'approvals',
};

export function createAnswerEvidenceCollector() {
  const sources = new Map<Source, EvidenceItem>();
  function add(source: Source, status: EvidenceItem['status'], matches: Record<string, unknown>[]) {
    const previous = sources.get(source);
    sources.set(source, {
      source,
      status:
        previous?.status === 'indexing' || status === 'indexing'
          ? 'indexing'
          : previous?.status === 'unavailable' || status === 'unavailable'
            ? 'unavailable'
            : 'queried',
      latest: newer(previous?.latest ?? null, latest(matches)),
    });
  }
  return {
    observe(tool: string, input: unknown, output: unknown) {
      const value = record(output);
      const args = record(input);
      if (tool === 'retrieve_workspace_context') {
        if (value.error) {
          add('timeline', 'unavailable', []);
          return;
        }
        const failed = new Set(rows(value.adapterFailures).map((row) => row.adapter));
        const packet = record(value.evidencePack);
        add(
          'timeline',
          ['timeline_events', 'evidence_pack', 'conversation_context'].some((id) => failed.has(id))
            ? 'unavailable'
            : 'queried',
          [...rows(value.events), ...rows(packet.items)],
        );
        add('notes', failed.has('notes') ? 'unavailable' : 'queried', rows(value.notes));
        if (value.queriedObjects)
          add(
            'objects',
            ['object_search', 'object_detail', 'entity_profile'].some((id) => failed.has(id))
              ? 'unavailable'
              : 'queried',
            rows(value.objects),
          );
        if (value.queriedBoards)
          add('boards', failed.has('boards') ? 'unavailable' : 'queried', rows(value.boards));
        if (value.queriedDocuments)
          add(
            'documents',
            failed.has('documents') ? 'unavailable' : 'queried',
            rows(value.documents),
          );
        if (value.queriedCalendar)
          add(
            'calendar',
            failed.has('calendar') ? 'unavailable' : 'queried',
            rows(value.calendarEvents),
          );
        return;
      }
      if (!Object.hasOwn(sourcesForTools, tool)) return;
      const group = sourcesForTools[tool]!;
      const source =
        group === 'timeline' || group === 'integration'
          ? knownSource(args.provider ?? args.source ?? args.senderSource, group)
          : group;
      const document =
        tool === 'get_document'
          ? rows(value.versions).find((row) => row.version_id === value.current_version_id)
          : record(value.current_version);
      const processing = document?.processing_status;
      const unavailable = Boolean(value.error || value.ok === false || processing === 'failed');
      const indexing = ['pending', 'extracting', 'chunked', 'deferred'].includes(
        String(processing),
      );
      add(source, unavailable ? 'unavailable' : indexing ? 'indexing' : 'queried', [
        ...(document ? [document] : []),
        value,
        ...rows(value.results),
        ...rows(value.events),
        ...rows(value.documents),
        ...rows(value.history),
        ...rows(value.changes),
        ...rows(record(value.moment).evidence),
        ...rows(value.related_moments).flatMap((moment) => rows(moment.evidence)),
        ...rows(value.moments).flatMap((moment) => rows(moment.events ?? moment.evidence)),
      ]);
    },
    snapshot(): AnswerEvidence {
      return [...sources.values()];
    },
  };
}
