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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useReducer } from 'react';

import type { GlobalSearchKind, GlobalSearchResult } from '@timeline/shared/search';
import type { ComponentType, SVGProps, SyntheticEvent } from 'react';

import { fetchGlobalSearch } from '@/lib/global-search';
import { cn } from '@/lib/utils';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface SearchViewState {
  loading: boolean;
  results: GlobalSearchResult[];
  warnings: string[];
  error: string | null;
}
interface PageState extends SearchViewState {
  draft: string;
  query: string;
  activeFilter: string;
  source: string;
  from: string;
  to: string;
}
type PageAction =
  | { type: 'draft'; value: string }
  | { type: 'query'; value: string }
  | { type: 'filter'; value: string }
  | { type: 'source'; value: string }
  | { type: 'from'; value: string }
  | { type: 'to'; value: string }
  | {
      type: 'route_sync';
      query: string;
      source: string;
      from: string;
      to: string;
    }
  | { type: 'search_start' }
  | { type: 'search_success'; results: GlobalSearchResult[]; warnings: string[] }
  | { type: 'search_error'; error: string };

const FILTERS: { label: string; kinds: GlobalSearchKind[] | null }[] = [
  { label: 'All', kinds: null },
  { label: 'Timeline', kinds: ['timeline_event'] },
  { label: 'Documents', kinds: ['document_chunk'] },
  { label: 'Objects', kinds: ['object'] },
  { label: 'Tasks', kinds: ['task'] },
  { label: 'Calendar', kinds: ['calendar_event'] },
  { label: 'Boards', kinds: ['board'] },
  { label: 'Pages', kinds: ['quick_link', 'external_link'] },
];

const SOURCES = [
  ['web', 'Web'],
  ['telegram', 'Telegram'],
  ['slack', 'Slack'],
  ['email', 'Email'],
  ['document', 'Document'],
  ['meeting', 'Meeting'],
  ['integration', 'Integration'],
  ['calendar', 'Calendar'],
  ['system', 'System'],
] as const;

const RESULT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function pageReducer(state: PageState, action: PageAction): PageState {
  if (action.type === 'draft') return { ...state, draft: action.value };
  if (action.type === 'query') return { ...state, query: action.value };
  if (action.type === 'filter') return { ...state, activeFilter: action.value };
  if (action.type === 'source') return { ...state, source: action.value };
  if (action.type === 'from') return { ...state, from: action.value };
  if (action.type === 'to') return { ...state, to: action.value };
  if (action.type === 'route_sync') {
    if (
      state.query === action.query &&
      state.draft === action.query &&
      state.source === action.source &&
      state.from === action.from &&
      state.to === action.to
    ) {
      return state;
    }
    return {
      ...state,
      draft: action.query,
      query: action.query,
      source: action.source,
      from: action.from,
      to: action.to,
    };
  }
  if (action.type === 'search_start') return { ...state, loading: true, error: null };
  if (action.type === 'search_success') {
    return {
      ...state,
      loading: false,
      results: action.results,
      warnings: action.warnings,
      error: null,
    };
  }
  return {
    ...state,
    loading: false,
    results: [],
    warnings: [],
    error: action.error,
  };
}

function iconFor(kind: GlobalSearchKind): Icon {
  if (kind === 'timeline_event') return Search;
  if (kind === 'document_chunk') return FileText;
  if (kind === 'calendar_event') return CalendarDays;
  if (kind === 'board') return SquareKanban;
  if (kind === 'external_link') return ExternalLink;
  return LayoutDashboard;
}

function kindLabel(kind: GlobalSearchKind): string {
  if (kind === 'timeline_event') return 'Timeline';
  if (kind === 'document_chunk') return 'Document';
  if (kind === 'calendar_event') return 'Calendar';
  if (kind === 'quick_link') return 'Page';
  if (kind === 'external_link') return 'New tab';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function resultDate(result: GlobalSearchResult): string | null {
  const value = result.occurredAt ?? result.updatedAt ?? result.startAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return RESULT_DATE_FORMAT.format(date);
}

function SearchResultRow({ result }: { result: GlobalSearchResult }) {
  const Icon = iconFor(result.kind);
  const date = resultDate(result);
  const content = (
    <span className="flex min-w-0 items-start gap-3 px-3 py-3">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{result.title}</span>
          <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            {kindLabel(result.kind)}
          </span>
        </span>
        <span className="mt-1 line-clamp-2 text-sm text-fg-muted">{result.snippet}</span>
        <span className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
          {date ? <span>{date}</span> : null}
          {result.metadata?.source ? <span>{result.metadata.source}</span> : null}
          {result.metadata?.type ? <span>{result.metadata.type}</span> : null}
        </span>
      </span>
      {result.externalHref ? (
        <ExternalLink aria-hidden="true" className="mt-1 size-4 shrink-0 text-fg-dim" />
      ) : null}
    </span>
  );

  if (result.externalHref) {
    return (
      <a
        href={result.externalHref}
        target="_blank"
        rel="noreferrer"
        className="block border-b border-border transition-colors hover:bg-surface"
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={result.href}
      className="block border-b border-border transition-colors hover:bg-surface"
    >
      {content}
    </Link>
  );
}

interface GlobalSearchPageProps {
  initialQuery: string;
  initialSource?: string;
  initialFrom?: string;
  initialTo?: string;
}

export function GlobalSearchPage({
  initialQuery,
  initialSource = '',
  initialFrom = '',
  initialTo = '',
}: GlobalSearchPageProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(pageReducer, {
    draft: initialQuery,
    query: initialQuery,
    activeFilter: 'All',
    source: initialSource,
    from: initialFrom,
    to: initialTo,
    loading: false,
    results: [],
    warnings: [],
    error: null,
  });

  useEffect(() => {
    dispatch({
      type: 'route_sync',
      query: initialQuery,
      source: initialSource,
      from: initialFrom,
      to: initialTo,
    });
  }, [initialFrom, initialQuery, initialSource, initialTo]);

  const kinds = useMemo(
    () => FILTERS.find((filter) => filter.label === state.activeFilter)?.kinds ?? null,
    [state.activeFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'search_start' });
    fetchGlobalSearch({
      query: state.query,
      mode: 'full',
      kinds: kinds ?? undefined,
      source: state.source || null,
      from: state.from || null,
      to: state.to || null,
      limit: 60,
      signal: controller.signal,
    })
      .then((response) => {
        dispatch({
          type: 'search_success',
          results: response.results,
          warnings: response.warnings.map((warning) => warning.message),
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: 'search_error',
          error: err instanceof Error ? err.message : 'Search failed',
        });
      });
    return () => {
      controller.abort();
    };
  }, [kinds, state.from, state.query, state.source, state.to]);

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = state.draft.trim();
    dispatch({ type: 'query', value: trimmed });
    const params = new URLSearchParams();
    if (trimmed) params.set('q', trimmed);
    if (state.source) params.set('source', state.source);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    router.replace(params.toString() ? `/app/search?${params.toString()}` : '/app/search');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-fg-muted">
          Search pages, workspace objects, tasks, boards, calendar, timeline events, and documents.
        </p>
      </header>

      <form onSubmit={submit} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-dim" />
        <input
          type="search"
          aria-label="Search everything"
          value={state.draft}
          onChange={(event) => {
            dispatch({ type: 'draft', value: event.target.value });
          }}
          placeholder="Search everything"
          className="h-11 w-full rounded-sm border border-border bg-surface pl-10 pr-28 text-sm focus:border-border-strong focus:outline-none"
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 h-8 -translate-y-1/2 rounded-sm px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          Search
        </button>
      </form>

      <div className="space-y-3 border-y border-border py-3">
        <nav aria-label="Result type" className="flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => {
                dispatch({ type: 'filter', value: filter.label });
              }}
              className={cn(
                'inline-flex min-h-8 items-center rounded-sm border px-2.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors',
                state.activeFilter === filter.label
                  ? 'border-signal/50 bg-signal-soft text-signal'
                  : 'border-border text-fg-muted hover:bg-surface hover:text-fg',
              )}
            >
              {filter.label}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <select
            value={state.source}
            onChange={(event) => {
              dispatch({ type: 'source', value: event.target.value });
            }}
            className="h-9 rounded-sm border border-border bg-bg px-2 text-sm focus:border-border-strong focus:outline-none"
          >
            <option value="">All sources</option>
            {SOURCES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={state.from}
            aria-label="From"
            onChange={(event) => {
              dispatch({ type: 'from', value: event.target.value });
            }}
            className="h-9 rounded-sm border border-border bg-bg px-2 text-sm font-mono focus:border-border-strong focus:outline-none"
          />
          <input
            type="date"
            value={state.to}
            aria-label="To"
            onChange={(event) => {
              dispatch({ type: 'to', value: event.target.value });
            }}
            className="h-9 rounded-sm border border-border bg-bg px-2 text-sm font-mono focus:border-border-strong focus:outline-none"
          />
        </div>
      </div>

      {state.warnings.length > 0 ? (
        <div className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
          {state.warnings.join(' ')}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-sm border border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            {state.loading ? 'Searching' : `${state.results.length} results`}
          </p>
          {state.loading ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin text-fg-dim" />
          ) : null}
        </div>
        {state.error ? (
          <p className="px-3 py-8 text-sm text-destructive">{state.error}</p>
        ) : state.results.length === 0 && !state.loading ? (
          <p className="px-3 py-8 text-sm text-fg-muted">No matches.</p>
        ) : (
          state.results.map((result) => <SearchResultRow key={result.id} result={result} />)
        )}
      </section>
    </div>
  );
}
