'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

import type { KeyboardEvent } from 'react';

interface Props {
  source?: string | null;
  from?: string | null;
  to?: string | null;
}

export function TimelineSearchField({ source, from, to }: Props) {
  const router = useRouter();

  function openSearch(rawQuery: string): void {
    const query = rawQuery.trim();
    if (!query) return;
    const params = new URLSearchParams({ q: query });
    if (source) params.set('source', source);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    router.push(`/app/search?${params.toString()}`);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    openSearch(event.currentTarget.value);
  }

  return (
    <label className="relative block min-w-0">
      <span className="sr-only">Search timeline</span>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-dim"
        aria-hidden
      />
      <input
        name="__q"
        type="search"
        placeholder="Search timeline…"
        autoComplete="off"
        onKeyDown={onSearchKeyDown}
        onInput={(event) => {
          event.stopPropagation();
        }}
        onChange={(event) => {
          event.stopPropagation();
        }}
        className="h-9 w-full rounded-sm border-0 bg-transparent py-1 pl-8 pr-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-dim focus-visible:ring-2 focus-visible:ring-signal/40"
      />
    </label>
  );
}
