import { getAudioBucket, getS3PresignClient, getSignedGetObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { localDateFromInstant } from '@timeline/shared/time';
import { z } from 'zod';

import type {
  ArtifactPreview,
  ArtifactPreviewSection,
  ArtifactRef,
} from '@timeline/shared/citation';

import { resolveActiveTeam } from '@/lib/active-team';
import { getArtifactRoutePreview } from '@/lib/artifact-routes';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuid = z.string().regex(new RegExp(`^${UUID_SOURCE}$`, 'i'));
const routeId = z.string().regex(/^[a-z][a-z0-9_/-]{0,80}$/);

const artifactRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeline_event'), id: uuid }),
  z.object({ kind: z.literal('object'), id: uuid }),
  z.object({ kind: z.literal('object_note'), id: uuid }),
  z.object({
    kind: z.literal('document_chunk'),
    id: uuid,
    documentId: uuid,
    version: z.number().int().min(0).max(100_000),
    chunkId: uuid,
  }),
  z.object({ kind: z.literal('calendar_event'), id: uuid }),
  z.object({ kind: z.literal('board'), id: uuid }),
  z.object({ kind: z.literal('board_item'), id: uuid }),
  z.object({ kind: z.literal('task'), id: uuid }),
  z.object({ kind: z.literal('route'), id: routeId }),
]);

const requestSchema = z.object({ ref: artifactRefSchema });

function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}

function compact(value: string | null | undefined, max = 900): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateLabel(value: Date | string | null | undefined): string | null {
  const iso = isoDate(value);
  if (!iso) return null;
  return new Date(iso).toLocaleString('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return dateLabel(value);
  if (typeof value === 'object') return JSON.stringify(value);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString();
  }
  if (typeof value === 'symbol') return value.description ?? null;
  return null;
}

function badges(values: (string | null | undefined | false)[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function items(entries: [string, unknown][]): { label: string; value: string }[] {
  return entries
    .map(([label, value]) => {
      const rendered = stringValue(value);
      return rendered ? { label, value: rendered } : null;
    })
    .filter((entry): entry is { label: string; value: string } => entry !== null);
}

async function signedAudioUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    const s3 = getS3PresignClient();
    return await getSignedGetObjectUrl(s3, getAudioBucket(), key, 3600);
  } catch {
    return null;
  }
}

type TeamScope = ReturnType<typeof withTeam>;

async function timelineEventPreview(
  scope: TeamScope,
  ref: ArtifactRef,
): Promise<ArtifactPreview | null> {
  if (ref.kind !== 'timeline_event') return null;
  const event = (await scope.timeline.getEventsByIds([ref.id]))[0];
  if (!event) return null;
  const audioUrl = await signedAudioUrl(event.contentAudioUrl);
  return {
    ref,
    title: 'Timeline Event',
    subtitle: [event.source, dateLabel(event.occurredAt)].filter(Boolean).join(' · '),
    body: compact(event.contentText),
    badges: [event.source],
    href: `/app/timeline?event=${event.id}#ev-${event.id}`,
    media: audioUrl ? { kind: 'audio', url: audioUrl, label: 'Event audio' } : null,
    sections: [
      {
        title: 'Metadata',
        items: items([
          ['Source', event.source],
          ['Occurred', event.occurredAt],
          ['Visibility', event.visibility],
        ]),
      },
    ],
  };
}

async function objectPreview(scope: TeamScope, ref: ArtifactRef): Promise<ArtifactPreview | null> {
  if (ref.kind !== 'object' && ref.kind !== 'task') return null;
  const object = await scope.objects.getObject(ref.id);
  if (!object) return null;
  if (ref.kind === 'task' && object.type !== 'task' && object.type !== 'follow_up') return null;
  const sections: ArtifactPreviewSection[] = [
    {
      title: 'Details',
      items: items([
        ['Type', object.type],
        ['Status', object.status],
        ['Stage', object.stage],
        ['Priority', object.priority],
        ['Due', object.dueAt],
        ['Aliases', object.aliases.join(', ')],
      ]),
    },
  ];
  if (object.notes.length > 0) {
    sections.push({
      title: 'Recent Notes',
      items: object.notes.slice(0, 4).map((note) => ({
        label: dateLabel(note.createdAt) ?? 'Note',
        value: compact(note.body, 240) ?? '',
      })),
    });
  }
  if (object.openTasks.length > 0) {
    sections.push({
      title: 'Open Tasks',
      items: object.openTasks.slice(0, 6).map((task) => ({
        label: task.status,
        value: task.canonicalName,
      })),
    });
  }
  if (object.relationships.length > 0) {
    sections.push({
      title: 'Relationships',
      items: object.relationships.slice(0, 6).map((relationship) => ({
        label: relationship.kind,
        value: relationship.otherName,
      })),
    });
  }
  return {
    ref,
    title: object.canonicalName,
    subtitle: `${object.type} · ${object.status}`,
    body: compact(object.notes[0]?.body ?? null, 500),
    badges: badges([object.type, object.status, object.stage]),
    href: `/app/objects/${object.id}`,
    sections,
  };
}

async function notePreview(scope: TeamScope, ref: ArtifactRef): Promise<ArtifactPreview | null> {
  if (ref.kind !== 'object_note') return null;
  const note = await scope.objects.getObjectNotePreview(ref.id);
  if (!note) return null;
  return {
    ref,
    title: `Note on ${note.object.canonicalName}`,
    subtitle: `${note.object.type} · ${dateLabel(note.createdAt) ?? 'object note'}`,
    body: compact(note.body),
    badges: ['note', note.object.type],
    href: `/app/objects/${note.object.id}`,
    sections: [
      {
        title: 'Object',
        items: items([
          ['Name', note.object.canonicalName],
          ['Status', note.object.status],
          ['Updated', note.updatedAt],
        ]),
      },
    ],
  };
}

async function documentChunkPreview(
  scope: TeamScope,
  ref: ArtifactRef,
): Promise<ArtifactPreview | null> {
  if (ref.kind !== 'document_chunk') return null;
  if (ref.id !== ref.chunkId) return null;
  const [document, chunk, versions] = await Promise.all([
    scope.documents.getDocument(ref.documentId),
    scope.documents.getDocumentChunk(ref.chunkId),
    scope.documents.listDocumentVersions(ref.documentId),
  ]);
  const version = versions.find((entry) => entry.version === ref.version);
  if (
    !document ||
    !chunk ||
    !version ||
    chunk.documentId !== document.id ||
    chunk.documentVersionId !== version.id
  ) {
    return null;
  }
  return {
    ref,
    title: document.name,
    subtitle: `Document · v${String(ref.version)} · chunk ${String(chunk.chunkIndex + 1)}`,
    body: compact(chunk.text),
    badges: badges([
      document.fileKind,
      chunk.representationKind,
      chunk.pageNumber ? `p.${String(chunk.pageNumber)}` : null,
    ]),
    href: `/app/documents/${document.id}?version=${String(ref.version)}#chunk-${chunk.id}`,
    sections: [
      {
        title: 'Chunk',
        items: items([
          ['Summary', chunk.summary],
          ['Page', chunk.pageNumber],
          ['Tokens', chunk.tokenCount],
          ['Created', chunk.createdAt],
        ]),
      },
    ],
  };
}

async function calendarEventPreview(
  scope: TeamScope,
  ref: ArtifactRef,
): Promise<ArtifactPreview | null> {
  if (ref.kind !== 'calendar_event') return null;
  const event = await scope.calendar.getCalendarEvent(ref.id);
  if (!event) return null;
  const href = `/app/calendar?view=week&date=${localDateFromInstant(
    event.startAt.toISOString(),
    event.timezone,
  )}`;
  return {
    ref,
    title: event.title,
    subtitle: [dateLabel(event.startAt), event.timezone].filter(Boolean).join(' · '),
    body: compact(event.description),
    badges: badges([
      event.showAs,
      event.allDay ? 'all-day' : null,
      event.rrule ? 'recurring' : null,
      event.redacted ? 'redacted' : null,
    ]),
    href,
    sections: [
      {
        title: 'Calendar',
        items: items([
          ['Start', event.startAt],
          ['End', event.endAt],
          ['Location', event.location],
          ['Visibility', event.visibility],
        ]),
      },
    ],
  };
}

async function boardPreview(scope: TeamScope, ref: ArtifactRef): Promise<ArtifactPreview | null> {
  if (ref.kind !== 'board') return null;
  const board = await scope.boards.getBoard(ref.id, { itemLimit: 12 });
  if (!board) return null;
  return {
    ref,
    title: board.name,
    subtitle: `${board.templateKind} · ${String(board.itemCount)} items`,
    body: compact(board.purpose),
    badges: badges([
      board.templateKind,
      board.pinned ? 'pinned' : null,
      board.isShared ? 'shared' : null,
    ]),
    href: `/app/boards/${board.id}`,
    sections: [
      {
        title: 'Lanes',
        items: board.lanes.slice(0, 8).map((lane) => ({
          label: lane.kind ?? 'lane',
          value: lane.name,
        })),
      },
      {
        title: 'Items',
        items: board.items.slice(0, 8).map((item) => ({
          label: item.object.type,
          value: item.object.canonicalName,
        })),
      },
    ],
  };
}

async function boardItemPreview(
  scope: TeamScope,
  ref: ArtifactRef,
): Promise<ArtifactPreview | null> {
  if (ref.kind !== 'board_item') return null;
  const item = await scope.boards.getBoardItem(ref.id);
  if (!item) return null;
  const board = await scope.boards.getBoard(item.boardId, { itemLimit: 0 });
  if (!board) return null;
  const lane = board.lanes.find((entry) => entry.id === item.laneId);
  return {
    ref,
    title: item.object.canonicalName,
    subtitle: `${board.name}${lane ? ` · ${lane.name}` : ''}`,
    body: compact(item.notes ?? item.nextStep),
    badges: badges([
      item.object.type,
      item.object.status,
      item.priority ? `P${String(item.priority)}` : null,
    ]),
    href: `/app/boards/${item.boardId}?item=${item.id}`,
    sections: [
      {
        title: 'Board Item',
        items: items([
          ['Board', board.name],
          ['Lane', lane?.name],
          ['Next step', item.nextStep],
          ['Due', item.dueAt],
          ['Responsible', item.responsibleUserId],
        ]),
      },
    ],
  };
}

function routePreview(ref: ArtifactRef): ArtifactPreview | null {
  if (ref.kind !== 'route') return null;
  const route = getArtifactRoutePreview(ref.id);
  if (!route) return null;
  return {
    ref,
    title: route.title,
    subtitle: route.group === 'help' ? 'Usage guide' : 'Dashboard route',
    body: route.description,
    badges: [route.group],
    href: route.href,
  };
}

async function hydratePreview(scope: TeamScope, ref: ArtifactRef): Promise<ArtifactPreview | null> {
  switch (ref.kind) {
    case 'timeline_event':
      return timelineEventPreview(scope, ref);
    case 'object':
    case 'task':
      return objectPreview(scope, ref);
    case 'object_note':
      return notePreview(scope, ref);
    case 'document_chunk':
      return documentChunkPreview(scope, ref);
    case 'calendar_event':
      return calendarEventPreview(scope, ref);
    case 'board':
      return boardPreview(scope, ref);
    case 'board_item':
      return boardItemPreview(scope, ref);
    case 'route':
      return routePreview(ref);
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return notFound();

  const scope = withTeam(db, active.teamId, session.user.id);
  let preview: ArtifactPreview | null = null;
  try {
    preview = await hydratePreview(scope, parsed.data.ref);
  } catch {
    preview = null;
  }
  return preview ? Response.json({ preview }) : notFound();
}
