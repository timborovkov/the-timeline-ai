'use client';

// Sub-path import (see @timeline/shared exports map) so the client bundle
// doesn't pull the queue/qdrant/llm modules that the package index
// re-exports — those drag in bullmq → ioredis → node:dns and fail the
// Next.js client compile.
import { parseCitations } from '@timeline/shared/citation';

import { CitationChip } from '@/components/citation-chip';

interface Props {
  text: string;
}

/**
 * Splits the assistant's text into runs and citation chips. Each chip is
 * a {@link CitationChip} in `href` mode:
 *  - `[ev:<id>]` → `/app/timeline#ev-<id>` (URL hash scrolls to the row)
 *  - `[ent:<id>]` → `/app/objects/<id>`
 *  - `[doc:<id>#v<n>:chunk:<id>]` →
 *    `/app/documents/<id>?version=<n>#chunk-<id>`
 *
 * The visual matches the system-wide citation primitive — mono lime
 * brackets on a signal-soft background — so chips inside chat read the
 * same as chips anywhere else.
 *
 * Plain text runs preserve newlines via `whitespace-pre-wrap`.
 *
 * Parsing lives in @timeline/shared so the regex is unit-tested without
 * a React/Next render.
 */
export function CitationText({ text }: Props) {
  const parts = parseCitations(text);
  let cursor = 0;
  const keyedParts = parts.map((part) => {
    const start = cursor;
    if (part.type === 'text') cursor += part.value.length;
    else if (part.type === 'doc') cursor += part.documentId.length + part.chunkId.length;
    else cursor += part.value.length;
    return { part, key: `${part.type}:${start}:${cursor}` };
  });

  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {keyedParts.map(({ part: p, key }) => {
        if (p.type === 'text') return <span key={key}>{p.value}</span>;
        if (p.type === 'ev') {
          return (
            <span key={key} className="mx-0.5">
              <CitationChip
                id={`ev:${p.value.slice(0, 8)}`}
                source="Event"
                href={`/app/timeline#ev-${p.value}`}
              />
            </span>
          );
        }
        if (p.type === 'ent') {
          return (
            <span key={key} className="mx-0.5">
              <CitationChip
                id={`ent:${p.value.slice(0, 8)}`}
                source="Entity"
                href={`/app/objects/${p.value}`}
              />
            </span>
          );
        }
        // p.type === 'doc' — Phase 9: chunk-precise citation. Link
        // carries the version + chunk hash so the document detail
        // page can scroll to the exact cited slice.
        return (
          <span key={key} className="mx-0.5">
            <CitationChip
              id={`doc:${p.documentId.slice(0, 8)}#v${p.version}`}
              source="Document"
              href={`/app/documents/${p.documentId}?version=${p.version}#chunk-${p.chunkId}`}
            />
          </span>
        );
      })}
    </p>
  );
}
