'use client';

// Sub-path import (see @timeline/shared exports map) so the client bundle
// doesn't pull the queue/qdrant/llm modules that the package index
// re-exports — those drag in bullmq → ioredis → node:dns and fail the
// Next.js client compile.
import { parseCitations } from '@timeline/shared/citation';
import Link from 'next/link';

interface Props {
  text: string;
}

/**
 * Splits the assistant's text into runs and citation chips. Each chip is
 * a link:
 *  - [ev:<id>]  → /app/timeline#ev-<id>
 *  - [ent:<id>] → /app/objects/<id>
 *  - [doc:<id>#v<n>:chunk:<id>] → /app/documents/<id>?version=<n>#chunk-<id>
 * Plain text runs preserve newlines via `whitespace-pre-wrap`.
 *
 * Parsing lives in @timeline/shared so the regex is unit-tested without
 * a React/Next render.
 */
export function CitationText({ text }: Props) {
  const parts = parseCitations(text);

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
              // natively — no client effect needed.
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
