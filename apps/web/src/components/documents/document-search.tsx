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
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={draft}
          aria-label="Search document chunks"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          placeholder="Search document chunks"
          className="h-10 w-full rounded-sm border border-border bg-surface pl-9 pr-24 text-sm focus:border-border-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || search.isFetching}
          className="absolute right-2 top-1/2 h-7 -translate-y-1/2 rounded-sm px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:bg-surface-2 disabled:opacity-40"
        >
          {search.isFetching ? 'Searching' : 'Search'}
        </button>
      </form>
      {query && (
        <div className="space-y-2">
          {hits.map((hit) => (
            <Link
              key={hit.documentChunkId}
              href={`/app/documents/${hit.documentId}?version=${String(hit.version)}#chunk-${hit.documentChunkId}`}
              className="block rounded-sm border border-border bg-surface px-4 py-3 text-sm hover:border-border-strong"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{hit.documentName}</span>
                <span className="font-mono text-[11px] text-fg-dim">
                  score {hit.score.toFixed(3)}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 text-fg-muted">{hit.summary ?? hit.text}</p>
            </Link>
          ))}
          <button
            type="button"
            disabled={!search.hasNextPage || search.isFetchingNextPage}
            onClick={() => {
              void search.fetchNextPage();
            }}
            className="rounded-sm border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:bg-surface disabled:opacity-40"
          >
            {search.isFetchingNextPage ? 'Loading…' : search.hasNextPage ? 'Load more' : 'End'}
          </button>
        </div>
      )}
    </section>
  );
}
