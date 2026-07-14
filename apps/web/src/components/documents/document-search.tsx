'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useDocumentSearchQuery } from '@/lib/use-paginated-queries';

export function DocumentSearch() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const search = useDocumentSearchQuery(query);
  const hits = search.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={draft}
          aria-label="Search document chunks"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            setQuery(draft.trim());
          }}
          placeholder="Search document chunks"
          className="h-10 w-full rounded-sm border border-border bg-surface pl-9 pr-24 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        />
        <button
          type="button"
          onClick={() => {
            setQuery(draft.trim());
          }}
          disabled={!draft.trim() || search.isFetching}
          className="absolute right-2 top-1/2 h-7 -translate-y-1/2 rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 disabled:opacity-40"
        >
          {search.isFetching ? 'Searching' : 'Search'}
        </button>
      </div>
      {query && (
        <div className="space-y-2">
          {hits.map((hit) => (
            <Link
              key={hit.documentChunkId}
              href={`/app/documents/${hit.documentId}?version=${String(hit.version)}#chunk-${hit.documentChunkId}`}
              className="block rounded-sm border border-border bg-surface px-4 py-3 text-sm hover:border-border-strong"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{hit.documentDisplayTitle}</span>
                <span className="font-mono text-[11px] text-fg-dim">
                  score {hit.score.toFixed(3)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-fg-dim">
                v{String(hit.version)} · {hit.fileKind} ·{' '}
                {hit.representationKind.replace(/_/g, ' ')}
                {hit.pageNumber !== null ? ` · page ${String(hit.pageNumber)}` : ''}
              </p>
              <p className="mt-1 line-clamp-3 text-fg-muted">{hit.summary ?? hit.text}</p>
            </Link>
          ))}
          {search.hasNextPage || search.isFetchingNextPage ? (
            <button
              type="button"
              disabled={search.isFetchingNextPage}
              onClick={() => {
                void search.fetchNextPage();
              }}
              className="rounded-sm border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface disabled:opacity-40"
            >
              {search.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
