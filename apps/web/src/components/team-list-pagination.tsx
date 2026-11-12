'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

const PAGE_SIZE = 50;

function subscribeLocale(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => {
    window.removeEventListener('languagechange', onChange);
  };
}

function browserLocale() {
  return navigator.language;
}
function serverLocale() {
  return 'en-US';
}

export function useTeamListPage<T>(items: T[]) {
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const navigationRequested = useRef(false);
  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  if (page !== currentPage) setPage(currentPage);
  useEffect(() => {
    if (!navigationRequested.current) return;
    navigationRequested.current = false;
    listRef.current?.focus({ preventScroll: true });
    listRef.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
  }, [currentPage]);
  const start = currentPage * PAGE_SIZE;
  return {
    listRef,
    visibleItems: items.slice(start, start + PAGE_SIZE),
    pagination: {
      page: currentPage,
      total: items.length,
      onPageChange: (nextPage: number) => {
        navigationRequested.current = true;
        setPage(nextPage);
      },
    },
  };
}

export function TeamListPagination({
  page,
  total,
  onPageChange,
  label,
  noun,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string;
  noun: string;
}) {
  const locale = useSyncExternalStore(subscribeLocale, browserLocale, serverLocale);
  if (total <= PAGE_SIZE) return null;
  const format = new Intl.NumberFormat(locale);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-3 pt-3">
      <p aria-live="polite" className="text-sm text-fg-muted tabular-nums">
        {format.format(page * PAGE_SIZE + 1)}–
        {format.format(Math.min((page + 1) * PAGE_SIZE, total))} of {format.format(total)} {noun}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={page === 0}
        onClick={() => {
          onPageChange(page - 1);
        }}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={(page + 1) * PAGE_SIZE >= total}
        onClick={() => {
          onPageChange(page + 1);
        }}
      >
        Next
      </Button>
    </nav>
  );
}
