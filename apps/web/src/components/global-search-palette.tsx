'use client';

import {
  CalendarDays,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Loader2,
  Search,
  SquareKanban,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { GlobalSearchResult } from '@timeline/shared/search';
import type { ComponentType, SVGProps } from 'react';

import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { fetchGlobalSearch } from '@/lib/global-search';
import { cn } from '@/lib/utils';
import { searchErrorMessage } from '@/lib/ux-errors';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface PaletteViewState {
  loading: boolean;
  results: GlobalSearchResult[];
  error: string | null;
  activeIndex: number;
}
type PaletteViewAction =
  | { type: 'search_start' }
  | { type: 'search_success'; results: GlobalSearchResult[] }
  | { type: 'search_error'; error: string }
  | { type: 'active'; value: number }
  | { type: 'reset_active' };

const GROUP_ORDER = ['Go to', 'Work', 'Timeline', 'Documents', 'Calendar', 'Other'] as const;

function paletteViewReducer(state: PaletteViewState, action: PaletteViewAction): PaletteViewState {
  if (action.type === 'search_start') return { ...state, loading: true, error: null };
  if (action.type === 'search_success') {
    return { loading: false, results: action.results, error: null, activeIndex: -1 };
  }
  if (action.type === 'search_error') {
    return { loading: false, results: [], error: action.error, activeIndex: -1 };
  }
  if (action.type === 'active') return { ...state, activeIndex: action.value };
  return { ...state, activeIndex: -1 };
}

function resultGroup(result: GlobalSearchResult): (typeof GROUP_ORDER)[number] {
  if (result.kind === 'quick_link' || result.kind === 'external_link') {
    return 'Go to';
  }
  if (result.kind === 'timeline_event') return 'Timeline';
  if (result.kind === 'document_chunk') return 'Documents';
  if (result.kind === 'calendar_event') return 'Calendar';
  return 'Work';
}

function resultIcon(kind: GlobalSearchResult['kind']): Icon {
  if (kind === 'timeline_event') return Search;
  if (kind === 'document_chunk') return FileText;
  if (kind === 'calendar_event') return CalendarDays;
  if (kind === 'board') return SquareKanban;
  if (kind === 'external_link') return ExternalLink;
  return LayoutDashboard;
}

function resultKindLabel(kind: GlobalSearchResult['kind']): string {
  return kind.replace(/_/g, ' ');
}

function openResult(result: GlobalSearchResult, router: ReturnType<typeof useRouter>): void {
  if (result.externalHref) {
    window.open(result.externalHref, '_blank', 'noopener,noreferrer');
    return;
  }
  router.push(result.href);
}

interface Props {
  hint?: string;
  className?: string;
}

export function GlobalSearchPalette({ hint, className }: Props) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [view, dispatchView] = useReducer(paletteViewReducer, {
    loading: false,
    results: [],
    error: null,
    activeIndex: -1,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      dispatchView({ type: 'search_start' });
      fetchGlobalSearch({
        query,
        mode: 'preview',
        limit: 12,
        signal: controller.signal,
      })
        .then((response) => {
          dispatchView({ type: 'search_success', results: response.results });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          dispatchView({
            type: 'search_error',
            error: searchErrorMessage(err instanceof Error ? err.message : undefined),
          });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, GlobalSearchResult[]>();
    for (const group of GROUP_ORDER) map.set(group, []);
    for (const result of view.results) map.get(resultGroup(result))?.push(result);
    const groups: [string, GlobalSearchResult[]][] = [];
    for (const group of GROUP_ORDER) {
      const items = map.get(group) ?? [];
      if (items.length > 0) groups.push([group, items]);
    }
    return groups;
  }, [view.results]);
  const selectableResults = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  const searchHref = query.trim()
    ? `/app/search?q=${encodeURIComponent(query.trim())}`
    : '/app/search';
  const selectableCount = selectableResults.length + (query.trim() ? 1 : 0);

  function submitSearch(): void {
    setOpen(false);
    router.push(searchHref);
  }

  return (
    <div ref={rootRef} className={cn('relative flex-1', className)}>
      <div
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-sm border border-border bg-surface px-3',
          'focus-within:border-border-strong focus-within:ring-2 focus-within:ring-signal/40 focus-within:ring-offset-2 focus-within:ring-offset-bg',
          'transition-colors',
        )}
      >
        <span aria-hidden="true" className="text-xs text-signal">
          ⌘K
        </span>
        <Search aria-hidden="true" className="size-3.5 text-fg-dim" />
        <label htmlFor="global-search-input" className="sr-only">
          Search or jump
        </label>
        <input
          id="global-search-input"
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Ask, jump, capture, or search…"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-dim focus:outline-none"
          onFocus={() => {
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              dispatchView({
                type: 'active',
                value: Math.min(view.activeIndex + 1, selectableCount - 1),
              });
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              dispatchView({ type: 'active', value: Math.max(view.activeIndex - 1, -1) });
              return;
            }
            if (event.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const selected =
              view.activeIndex >= 0 && view.activeIndex < selectableResults.length
                ? selectableResults[view.activeIndex]
                : null;
            if (selected) {
              setOpen(false);
              openResult(selected, router);
              return;
            }
            submitSearch();
          }}
        />
        {view.loading ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-fg-dim" />
        ) : null}
        {hint ? (
          <span aria-hidden="true" className="hidden text-xs text-fg-dim lg:inline">
            {hint}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[min(34rem,calc(100vh-5rem))] overflow-y-auto rounded-sm border border-border bg-bg shadow-xl">
          {view.error ? (
            <p className="p-3 text-sm text-destructive">{view.error}</p>
          ) : grouped.length === 0 && !view.loading ? (
            <p className="p-3 text-sm text-fg-muted">No matches.</p>
          ) : (
            <div className="py-2">
              {grouped.map(([group, items]) => (
                <div key={group} className="py-1">
                  <p className="px-3 py-1 text-[11px] text-fg-dim">{group}</p>
                  {items.map((result) => {
                    const index = selectableResults.indexOf(result);
                    const IconComponent = resultIcon(result.kind);
                    return (
                      <div
                        key={result.id}
                        className={cn(
                          'flex items-center transition-colors',
                          view.activeIndex === index ? 'bg-surface-2' : 'hover:bg-surface',
                        )}
                        onMouseEnter={() => {
                          dispatchView({ type: 'active', value: index });
                        }}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                          onClick={() => {
                            setOpen(false);
                            openResult(result, router);
                          }}
                        >
                          <IconComponent
                            aria-hidden="true"
                            className="size-4 shrink-0 text-fg-muted"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {result.title}
                            </span>
                            <span className="block truncate text-xs text-fg-muted">
                              {result.snippet}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-fg-dim">
                            {result.externalHref ? 'new tab' : resultKindLabel(result.kind)}
                          </span>
                        </button>
                        {result.pinTarget ? (
                          <div className="mr-2 shrink-0">
                            <PinOverflowMenu
                              target={result.pinTarget}
                              title={result.title}
                              initialPinned={result.pinned ?? false}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {query.trim() ? (
                <button
                  type="button"
                  className={cn(
                    'mt-1 flex w-full items-center gap-3 border-t border-border px-3 py-2 text-left transition-colors',
                    view.activeIndex === selectableResults.length
                      ? 'bg-surface-2'
                      : 'hover:bg-surface',
                  )}
                  onMouseEnter={() => {
                    dispatchView({ type: 'active', value: selectableResults.length });
                  }}
                  onClick={submitSearch}
                >
                  <Search aria-hidden="true" className="size-4 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    Search all results for <span className="font-medium">"{query.trim()}"</span>
                  </span>
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
