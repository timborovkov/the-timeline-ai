'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';

import { InlineError } from '@/components/inline-error';
import { useDocumentSearchQuery } from '@/lib/use-paginated-queries';
import { searchErrorMessage } from '@/lib/ux-errors';

export function DocumentSearch() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useDocumentSearchQuery(query);
  const hits = search.data?.pages.flatMap((page) => page.items) ?? [];
  const hasInitialSearchError = query.length > 0 && search.isError && hits.length === 0;
  const hasNoMatches = query.length > 0 && search.isSuccess && hits.length === 0;
  const errorCode = search.error instanceof Error ? search.error.message : undefined;
  const searchAnnouncement = !query
    ? ''
    : search.isFetching
      ? `Searching documents for ${query}`
      : hasInitialSearchError
        ? ''
        : hasNoMatches
          ? `No matches for ${query}`
          : `${String(hits.length)} document ${hits.length === 1 ? 'match' : 'matches'} for ${query}`;

  function submitSearch(): void {
    setQuery(draft.trim());
  }

  function clearSearch(): void {
    setDraft('');
    setQuery('');
    inputRef.current?.focus();
  }

  return (
    <section className="space-y-3">
      <search className="relative block">
        <label className="sr-only" htmlFor={inputId}>
          Search document chunks
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitSearch();
          }}
          placeholder="Search document chunks"
          className="h-10 w-full rounded-sm border border-border bg-surface pl-9 pr-24 text-base focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:text-sm"
        />
        <button
          type="button"
          onClick={submitSearch}
          disabled={!draft.trim() || search.isFetching}
          className="absolute right-2 top-1/2 h-7 -translate-y-1/2 rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
        >
          {search.isFetching ? 'Searching' : 'Search'}
        </button>
      </search>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {searchAnnouncement}
      </p>
      {query && (
        <div className="space-y-2">
          {hasInitialSearchError ? (
            <InlineError
              message={searchErrorMessage(errorCode)}
              details={errorCode}
              onRetry={() => {
                void search.refetch();
              }}
              retrying={search.isFetching}
              retryLabel="Retry search"
            />
          ) : hasNoMatches ? (
            <div className="rounded-lg border border-border bg-card/30 px-4 py-3 text-sm">
              <p className="font-medium">No matches for “{query}”</p>
              <p className="mt-1 text-fg-muted">
                Try a different phrase, or clear the search to return to the document browser.
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-3 rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              {hits.map((hit) => (
                <Link
                  key={hit.documentChunkId}
                  href={`/app/documents/${hit.documentId}?version=${String(hit.version)}#chunk-${hit.documentChunkId}`}
                  className="block rounded-lg border border-border bg-surface px-4 py-3 text-sm hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="font-medium">{hit.documentDisplayTitle}</span>
                  <p className="mt-1 text-[11px] text-fg-dim">
                    v{String(hit.version)} · {hit.fileKind}
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
                  className="rounded-sm border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
                >
                  {search.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}
