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
 *
 * UUID shape is validated client-side as defense-in-depth: the system
 * prompt tells the agent never to fabricate ids, but we never trust LLM
 * output to be well-formed.
 */

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const EV_OR_ENT_RE = new RegExp(`\\[(ev|ent):(${UUID_SOURCE})\\]`, 'gi');
const DOC_RE = new RegExp(`\\[doc:(${UUID_SOURCE})#v(\\d+):chunk:(${UUID_SOURCE})\\]`, 'gi');
const CITATION_RE = new RegExp(
  `(?:\\[(?:ev|ent):${UUID_SOURCE}\\])|(?:\\[doc:${UUID_SOURCE}#v\\d+:chunk:${UUID_SOURCE}\\])`,
  'gi',
);

export type CitationPart =
  | { type: 'text'; value: string }
  | { type: 'ev'; value: string }
  | { type: 'ent'; value: string }
  | { type: 'doc'; documentId: string; version: string; chunkId: string };

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
      EV_OR_ENT_RE.lastIndex = 0;
      const evMatch = EV_OR_ENT_RE.exec(raw);
      EV_OR_ENT_RE.lastIndex = 0;
      if (evMatch?.[1] && evMatch[2]) {
        const kind = evMatch[1].toLowerCase() === 'ent' ? 'ent' : 'ev';
        parts.push({ type: kind, value: evMatch[2] });
      }
    }
    lastIndex = start + raw.length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}
