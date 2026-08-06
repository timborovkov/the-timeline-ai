'use client';

import { ArrowRight, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { HELP_PAGES } from '@/lib/help-content';

function searchableText(page: (typeof HELP_PAGES)[number]): string {
  return [
    page.title,
    page.description,
    ...page.sections.flatMap((section) => [section.title, section.body, ...(section.items ?? [])]),
  ]
    .join(' ')
    .toLocaleLowerCase();
}

export function HelpGuideDirectory() {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? HELP_PAGES.filter((page) => searchableText(page).includes(normalizedQuery))
    : HELP_PAGES;

  return (
    <section aria-labelledby="guide-directory-title" className="border-t border-border pt-8">
      <div className="grid items-end gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-1">
          <h2 id="guide-directory-title" className="text-xl font-semibold tracking-tight text-fg">
            Guide directory
          </h2>
          <p className="max-w-[62ch] text-sm leading-6 text-fg-muted">
            Search by a task, source, or part of the product. Results include the full guide text,
            not just titles.
          </p>
        </div>
        <label className="relative block">
          <span className="sr-only">Search guides</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-dim"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search guides"
            className="h-10 w-full rounded-sm border border-input bg-surface-2 pl-9 pr-10 text-sm text-fg outline-none placeholder:text-fg-dim focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
              }}
              aria-label="Clear guide search"
              className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </label>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {matches.length} {matches.length === 1 ? 'guide' : 'guides'} found
      </p>

      <div className="mt-6 border-y border-border">
        {matches.length > 0 ? (
          matches.map((page) => (
            <Link
              key={page.slug}
              href={`/help/${page.slug}`}
              className="group grid gap-3 border-b border-border px-1 py-5 text-fg transition-[background-color,color,transform] last:border-b-0 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:translate-y-px forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-3"
            >
              <span className="flex items-center gap-3 sm:block">
                <span className="font-mono text-xs tabular-nums text-fg-dim">
                  {String(HELP_PAGES.indexOf(page) + 1).padStart(2, '0')}
                </span>
                <page.icon aria-hidden="true" className="size-5 text-signal sm:hidden" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold text-fg group-hover:text-signal">
                  {page.title}
                </span>
                <span className="mt-1 block max-w-[62ch] text-sm leading-6 text-fg-muted">
                  {page.description}
                </span>
              </span>
              <span className="hidden size-9 place-items-center text-fg-dim transition-transform group-hover:translate-x-1 group-hover:text-fg sm:grid">
                <ArrowRight aria-hidden="true" className="size-4" />
              </span>
            </Link>
          ))
        ) : (
          <div className="py-10 text-center">
            <p className="text-base font-semibold text-fg">No guide matches “{query.trim()}”</p>
            <p className="mt-1 text-sm text-fg-muted">Try a broader term or contact support.</p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
              }}
              className="mt-4 rounded-sm border border-border px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
