'use client';

import Link from 'next/link';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Matches [ev:<uuid>] or [ent:<uuid>]. Validating the UUID shape client-side
// is defense-in-depth — the system prompt tells the agent never to fabricate
// ids, but we never trust LLM output to be well-formed.
const CITATION_RE = new RegExp(`\\[(ev|ent):(${UUID_RE.source})\\]`, 'gi');

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
export function CitationText({ text }: Props) {
  const parts: { type: 'text' | 'ev' | 'ent'; value: string }[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, start) });
    }
    const kind = match[1]?.toLowerCase() === 'ent' ? 'ent' : 'ev';
    const id = match[2] ?? '';
    if (id) parts.push({ type: kind, value: id });
    lastIndex = start + match[0].length;
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
      })}
    </p>
  );
}
