'use client';

import Link from 'next/link';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Matches [ev:<uuid>], [ent:<uuid>], or [doc:<uuid>#v<n>:chunk:<uuid>].
// Validating each shape client-side is defense-in-depth — the system
// prompt tells the agent never to fabricate ids, but we never trust LLM
// output to be well-formed.
const EV_OR_ENT_RE = new RegExp(`\\[(ev|ent):(${UUID_RE.source})\\]`, 'gi');
const DOC_RE = new RegExp(
  `\\[doc:(${UUID_RE.source})#v(\\d+):chunk:(${UUID_RE.source})\\]`,
  'gi',
);
const CITATION_RE = new RegExp(
  `(?:\\[(?:ev|ent):${UUID_RE.source}\\])|(?:\\[doc:${UUID_RE.source}#v\\d+:chunk:${UUID_RE.source}\\])`,
  'gi',
);

interface Props {
  text: string;
}

/**
 * Splits the assistant's text into runs and citation chips. Each chip is
 * a link:
 *  - [ev:<id>] → /app/timeline?focus=<id>
 *  - [ent:<id>] → /app/objects/<id>
 * Plain text runs preserve newlines via `whitespace-pre-wrap`.
 */
type CitationPart =
  | { type: 'text'; value: string }
  | { type: 'ev'; value: string }
  | { type: 'ent'; value: string }
  | { type: 'doc'; documentId: string; version: string; chunkId: string };

export function CitationText({ text }: Props) {
  const parts: CitationPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, start) });
    }
    const raw = match[0];
    // Try doc first (longest, most specific). EV_OR_ENT_RE matches both
    // ev: and ent: — distinguish via the inner group.
    const docMatch = DOC_RE.exec(raw);
    DOC_RE.lastIndex = 0;
    if (docMatch && docMatch[1] && docMatch[3]) {
      parts.push({
        type: 'doc',
        documentId: docMatch[1],
        version: docMatch[2] ?? '1',
        chunkId: docMatch[3],
      });
    } else {
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

  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.value}</span>;
        if (p.type === 'ev') {
          return (
            <Link
              key={i}
              // URL hash + `id="ev-<uuid>"` on each timeline <li> +
              // `scroll-mt-20` for header offset. Browser handles the scroll
              // natively — no client effect needed. If the event isn't in the
              // first page of the timeline the user has to widen filters,
              // which we accept for v1 (timeline lists last 200 by default).
              href={`/app/timeline#ev-${p.value}`}
              className="mx-0.5 inline-block rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title={`Event ${p.value}`}
            >
              ev:{p.value.slice(0, 8)}
            </Link>
          );
        }
        if (p.type === 'ent') {
          return (
            <Link
              key={i}
              href={`/app/objects/${p.value}`}
              className="mx-0.5 inline-block rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title={`Entity ${p.value}`}
            >
              ent:{p.value.slice(0, 8)}
            </Link>
          );
        }
        // p.type === 'doc'
        return (
          <Link
            key={i}
            // Document detail page reads ?version=<n>#chunk-<id> to scroll
            // to the cited chunk in the version's text.
            href={`/app/documents/${p.documentId}?version=${p.version}#chunk-${p.chunkId}`}
            className="mx-0.5 inline-block rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={`Document ${p.documentId} v${p.version}, chunk ${p.chunkId}`}
          >
            doc:{p.documentId.slice(0, 8)}#v{p.version}
          </Link>
        );
      })}
    </p>
  );
}
