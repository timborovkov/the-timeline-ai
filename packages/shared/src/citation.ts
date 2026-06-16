/**
 * Citation parser for agent answers. Pure, framework-free so it can live
 * in `@timeline/shared` and be unit-tested without React/Next.js. The
 * `CitationText` component in `apps/web/src/components/chat/citation.tsx`
 * consumes `parseCitations` and renders each part.
 *
 * Supported citation forms (system prompt agent-v5-2026-05):
 *   - [ev:<uuid>]                                — raw timeline event
 *   - [ent:<uuid>]                               — workspace entity
 *   - [doc:<uuid>#v<n>:chunk:<uuid>]             — document chunk at a
 *                                                  specific immutable version
 *   - [note:<uuid>]                              — object note
 *   - [cal:<uuid>]                               — calendar event
 *   - [board:<uuid>]                             — board
 *   - [board-item:<uuid>]                        — board item
 *   - [task:<uuid>]                              — task/follow-up object
 *   - [route:<route-id>]                         — static app/help route
 *
 * UUID shape is validated client-side as defense-in-depth: the system
 * prompt tells the agent never to fabricate ids, but we never trust LLM
 * output to be well-formed.
 */

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE_ID_SOURCE = '[a-z][a-z0-9_/-]{0,80}';

const UUID_REF_RE = new RegExp(
  `\\[(ev|ent|note|cal|board|board-item|task):(${UUID_SOURCE})\\]`,
  'gi',
);
const DOC_RE = new RegExp(`\\[doc:(${UUID_SOURCE})#v(\\d+):chunk:(${UUID_SOURCE})\\]`, 'gi');
const ROUTE_RE = new RegExp(`\\[route:(${ROUTE_ID_SOURCE})\\]`, 'gi');
const CITATION_RE = new RegExp(
  `(?:\\[(?:ev|ent|note|cal|board|board-item|task):${UUID_SOURCE}\\])|(?:\\[doc:${UUID_SOURCE}#v\\d+:chunk:${UUID_SOURCE}\\])|(?:\\[route:${ROUTE_ID_SOURCE}\\])`,
  'gi',
);

export type ArtifactKind =
  | 'timeline_event'
  | 'object'
  | 'object_note'
  | 'document_chunk'
  | 'calendar_event'
  | 'board'
  | 'board_item'
  | 'task'
  | 'fact'
  | 'relationship'
  | 'object_change'
  | 'route';

export type ArtifactRef =
  | { kind: 'timeline_event'; id: string }
  | { kind: 'object'; id: string }
  | { kind: 'object_note'; id: string }
  | { kind: 'document_chunk'; id: string; documentId: string; version: number; chunkId: string }
  | { kind: 'calendar_event'; id: string }
  | { kind: 'board'; id: string }
  | { kind: 'board_item'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'fact'; id: string }
  | { kind: 'relationship'; id: string }
  | { kind: 'object_change'; id: string }
  | { kind: 'route'; id: string };

export interface ArtifactPreviewSection {
  title: string;
  body?: string | null;
  items?: { label: string; value: string }[];
}

export interface ArtifactPreview {
  ref: ArtifactRef;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  badges?: string[];
  sections?: ArtifactPreviewSection[];
  href?: string | null;
  media?: { kind: 'audio'; url: string; label?: string | null } | null;
}

export type CitationPart =
  | { type: 'text'; value: string }
  | { type: 'ev'; value: string }
  | { type: 'ent'; value: string }
  | { type: 'note'; value: string }
  | { type: 'doc'; documentId: string; version: string; chunkId: string }
  | { type: 'cal'; value: string }
  | { type: 'board'; value: string }
  | { type: 'board-item'; value: string }
  | { type: 'task'; value: string }
  | { type: 'route'; value: string };

export function citationPartToArtifactRef(
  part: Exclude<CitationPart, { type: 'text' }>,
): ArtifactRef {
  switch (part.type) {
    case 'ev':
      return { kind: 'timeline_event', id: part.value };
    case 'ent':
      return { kind: 'object', id: part.value };
    case 'note':
      return { kind: 'object_note', id: part.value };
    case 'doc':
      return {
        kind: 'document_chunk',
        id: part.chunkId,
        documentId: part.documentId,
        version: Number(part.version),
        chunkId: part.chunkId,
      };
    case 'cal':
      return { kind: 'calendar_event', id: part.value };
    case 'board':
      return { kind: 'board', id: part.value };
    case 'board-item':
      return { kind: 'board_item', id: part.value };
    case 'task':
      return { kind: 'task', id: part.value };
    case 'route':
      return { kind: 'route', id: part.value };
  }
}

export function artifactRefLabel(ref: ArtifactRef): string {
  switch (ref.kind) {
    case 'timeline_event':
      return `[ev:${ref.id.slice(0, 8)}]`;
    case 'object':
      return `[ent:${ref.id.slice(0, 8)}]`;
    case 'object_note':
      return `[note:${ref.id.slice(0, 8)}]`;
    case 'document_chunk':
      return `[doc:${ref.documentId.slice(0, 8)}#v${String(ref.version)}]`;
    case 'calendar_event':
      return `[cal:${ref.id.slice(0, 8)}]`;
    case 'board':
      return `[board:${ref.id.slice(0, 8)}]`;
    case 'board_item':
      return `[board-item:${ref.id.slice(0, 8)}]`;
    case 'task':
      return `[task:${ref.id.slice(0, 8)}]`;
    case 'fact':
      return `[fact:${ref.id.slice(0, 8)}]`;
    case 'relationship':
      return `[rel:${ref.id.slice(0, 8)}]`;
    case 'object_change':
      return `[chg:${ref.id.slice(0, 8)}]`;
    case 'route':
      return `[route:${ref.id}]`;
  }
}

export function artifactRefCitation(ref: ArtifactRef): string {
  switch (ref.kind) {
    case 'timeline_event':
      return `[ev:${ref.id}]`;
    case 'object':
      return `[ent:${ref.id}]`;
    case 'object_note':
      return `[note:${ref.id}]`;
    case 'document_chunk':
      return `[doc:${ref.documentId}#v${String(ref.version)}:chunk:${ref.chunkId}]`;
    case 'calendar_event':
      return `[cal:${ref.id}]`;
    case 'board':
      return `[board:${ref.id}]`;
    case 'board_item':
      return `[board-item:${ref.id}]`;
    case 'task':
      return `[task:${ref.id}]`;
    case 'fact':
      return `[fact:${ref.id}]`;
    case 'relationship':
      return `[rel:${ref.id}]`;
    case 'object_change':
      return `[chg:${ref.id}]`;
    case 'route':
      return `[route:${ref.id}]`;
  }
}

export function parseCitations(text: string): CitationPart[] {
  const parts: CitationPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, start) });
    }
    const raw = match[0];
    // Try doc first (longest, most specific). Reset lastIndex on each
    // exec since the inner regexes carry /g state.
    DOC_RE.lastIndex = 0;
    const docMatch = DOC_RE.exec(raw);
    DOC_RE.lastIndex = 0;
    if (docMatch?.[1] && docMatch[3]) {
      parts.push({
        type: 'doc',
        documentId: docMatch[1],
        version: docMatch[2] ?? '1',
        chunkId: docMatch[3],
      });
    } else {
      UUID_REF_RE.lastIndex = 0;
      const refMatch = UUID_REF_RE.exec(raw);
      UUID_REF_RE.lastIndex = 0;
      if (refMatch?.[1] && refMatch[2]) {
        const kind = refMatch[1].toLowerCase() as Exclude<
          CitationPart['type'],
          'text' | 'doc' | 'route'
        >;
        parts.push({ type: kind, value: refMatch[2] });
      } else {
        ROUTE_RE.lastIndex = 0;
        const routeMatch = ROUTE_RE.exec(raw);
        ROUTE_RE.lastIndex = 0;
        if (routeMatch?.[1]) {
          parts.push({ type: 'route', value: routeMatch[1] });
        }
      }
    }
    lastIndex = start + raw.length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}
