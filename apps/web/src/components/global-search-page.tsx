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

import { FilterMultiSelect } from '@/components/filter-multi-select';
import { selectedValues } from '@/lib/filter-values';
import { fetchGlobalSearch } from '@/lib/global-search';
import { searchErrorMessage } from '@/lib/ux-errors';

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
  typeFilters: string;
  source: string;
  from: string;
  to: string;
}
type PageAction =
  | { type: 'draft'; value: string }
  | { type: 'query'; value: string }
  | { type: 'type_filters'; value: string }
  | { type: 'source'; value: string }
  | { type: 'from'; value: string }
  | { type: 'to'; value: string }
  | { type: 'clear_filters' }
  | {
      type: 'route_sync';
      query: string;
      source: string;
      from: string;
      to: string;
      typeFilters: string;
    }
  | { type: 'search_start' }
  | { type: 'search_success'; results: GlobalSearchResult[]; warnings: string[] }
  | { type: 'search_error'; error: string };

const FILTERS: { label: string; param: string; kinds: GlobalSearchKind[] | null }[] = [
  { label: 'All', param: 'all', kinds: null },
  { label: 'Timeline', param: 'timeline', kinds: ['timeline_event'] },
  { label: 'Documents', param: 'documents', kinds: ['document_chunk'] },
  { label: 'Objects', param: 'objects', kinds: ['object'] },
  { label: 'Tasks', param: 'tasks', kinds: ['task'] },
  { label: 'Calendar', param: 'calendar', kinds: ['calendar_event'] },
  { label: 'Boards', param: 'boards', kinds: ['board'] },
  { label: 'Pages', param: 'pages', kinds: ['quick_link', 'external_link'] },
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

const RESULT_TYPE_OPTIONS: { value: string; label: string }[] = [];
const FILTERS_BY_PARAM = new Map<string, (typeof FILTERS)[number]>();
for (const filter of FILTERS) {
  FILTERS_BY_PARAM.set(filter.param, filter);
  if (filter.kinds) RESULT_TYPE_OPTIONS.push({ value: filter.param, label: filter.label });
}
const SOURCE_OPTIONS = SOURCES.map(([value, label]) => ({ value, label }));

const RESULT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function pageReducer(state: PageState, action: PageAction): PageState {
  if (action.type === 'draft') return { ...state, draft: action.value };
  if (action.type === 'query') return { ...state, query: action.value };
  if (action.type === 'type_filters') return { ...state, typeFilters: action.value };
  if (action.type === 'source') return { ...state, source: action.value };
  if (action.type === 'from') return { ...state, from: action.value };
  if (action.type === 'to') return { ...state, to: action.value };
  if (action.type === 'clear_filters') {
    return { ...state, typeFilters: '', source: '', from: '', to: '' };
  }
  if (action.type === 'route_sync') {
    if (
      state.query === action.query &&
      state.draft === action.query &&
      state.source === action.source &&
      state.from === action.from &&
      state.to === action.to &&
      state.typeFilters === action.typeFilters
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
      typeFilters: action.typeFilters,
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

function relatedEvidenceLabel(result: GlobalSearchResult): string | null {
  const name = result.metadata?.relatedEvidence;
  if (typeof name !== 'string' || !name.trim()) return null;
  const signalCount =
    typeof result.metadata?.relatedEvidenceSignals === 'number'
      ? result.metadata.relatedEvidenceSignals
      : null;
  const statusSources =
    typeof result.metadata?.relatedEvidenceStatusSources === 'number'
      ? result.metadata.relatedEvidenceStatusSources
      : 0;
  const signals = signalCount
    ? `${signalCount} signal${signalCount === 1 ? '' : 's'}`
    : 'related signals';
  const authority =
    statusSources > 0 ? ` · ${statusSources} status source${statusSources === 1 ? '' : 's'}` : '';
  return `${name} · ${signals}${authority}`;
}

function filtersFromParam(param: string): string {
  const selected = selectedValues(param, RESULT_TYPE_OPTIONS);
  return selected.join(',');
}

function kindsForFilters(input: string): GlobalSearchKind[] | null {
  const selected = selectedValues(input, RESULT_TYPE_OPTIONS);
  if (selected.length === 0) return null;
  const kinds = new Set<GlobalSearchKind>();
  for (const param of selected) {
    const filter = FILTERS_BY_PARAM.get(param);
    for (const kind of filter?.kinds ?? []) kinds.add(kind);
  }
  return Array.from(kinds);
}

function searchPath(input: {
  query: string;
  typeFilters: string;
  source: string;
  from: string;
  to: string;
}): string {
  const params = new URLSearchParams();
  const query = input.query.trim();
  if (query) params.set('q', query);
  if (input.typeFilters) params.set('type', input.typeFilters);
  if (input.source) params.set('source', input.source);
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  return params.toString() ? `/app/search?${params.toString()}` : '/app/search';
}

function DateFilterInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-36">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
        {label}
      </span>
      <input
        type="date"
        value={value}
        aria-label={label}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-xs font-mono text-fg outline-none transition-colors focus:border-signal/60"
      />
    </label>
  );
}

function SearchResultRow({ result }: { result: GlobalSearchResult }) {
  const Icon = iconFor(result.kind);
  const date = resultDate(result);
  const relatedEvidence = relatedEvidenceLabel(result);
  const content = (
    <span className="flex min-w-0 items-start gap-3 p-3">
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
        {relatedEvidence ? (
          <span className="mt-2 inline-flex max-w-full rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            <span className="truncate">Related evidence · {relatedEvidence}</span>
          </span>
        ) : null}
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
  initialType?: string;
  initialSource?: string;
  initialFrom?: string;
  initialTo?: string;
}

export function GlobalSearchPage({
  initialQuery,
  initialType = '',
  initialSource = '',
  initialFrom = '',
  initialTo = '',
}: GlobalSearchPageProps) {
  const router = useRouter();
  const initialTypeFilters = filtersFromParam(initialType);
  const [state, dispatch] = useReducer(pageReducer, {
    draft: initialQuery,
    query: initialQuery,
    typeFilters: initialTypeFilters,
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
      typeFilters: filtersFromParam(initialType),
    });
  }, [initialFrom, initialQuery, initialSource, initialTo, initialType]);

  const kinds = useMemo(() => kindsForFilters(state.typeFilters), [state.typeFilters]);
  const selectedSources = useMemo(
    () => selectedValues(state.source, SOURCE_OPTIONS),
    [state.source],
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'search_start' });
    fetchGlobalSearch({
      query: state.query,
      mode: 'full',
      kinds: kinds ?? undefined,
      source: selectedSources.length > 0 ? selectedSources : null,
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
          error: searchErrorMessage(err instanceof Error ? err.message : undefined),
        });
      });
    return () => {
      controller.abort();
    };
  }, [kinds, selectedSources, state.from, state.query, state.to]);

  function replaceSearchUrl(
    next: Partial<Pick<PageState, 'query' | 'typeFilters' | 'source' | 'from' | 'to'>>,
  ): void {
    router.replace(
      searchPath({
        query: next.query ?? state.query,
        typeFilters: next.typeFilters ?? state.typeFilters,
        source: next.source ?? state.source,
        from: next.from ?? state.from,
        to: next.to ?? state.to,
      }),
    );
  }

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = state.draft.trim();
    dispatch({ type: 'query', value: trimmed });
    replaceSearchUrl({ query: trimmed });
  }

  function clearFilters(): void {
    dispatch({ type: 'clear_filters' });
    replaceSearchUrl({ typeFilters: '', source: '', from: '', to: '' });
  }

  const filterCount =
    selectedValues(state.typeFilters, RESULT_TYPE_OPTIONS).length +
    selectedSources.length +
    (state.from ? 1 : 0) +
    (state.to ? 1 : 0);

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

      <div className="grid gap-3 border-y border-border py-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <FilterMultiSelect
            label="Result types"
            value={state.typeFilters}
            onValueChange={(value) => {
              dispatch({ type: 'type_filters', value });
              replaceSearchUrl({ typeFilters: value });
            }}
            placeholder="All results"
            options={RESULT_TYPE_OPTIONS}
          />
          <FilterMultiSelect
            label="Source"
            value={state.source}
            onValueChange={(value) => {
              dispatch({ type: 'source', value });
              replaceSearchUrl({ source: value });
            }}
            placeholder="All sources"
            options={SOURCE_OPTIONS}
          />
          <DateFilterInput
            label="From"
            value={state.from}
            onChange={(value) => {
              dispatch({ type: 'from', value });
              replaceSearchUrl({ from: value });
            }}
          />
          <DateFilterInput
            label="To"
            value={state.to}
            onChange={(value) => {
              dispatch({ type: 'to', value });
              replaceSearchUrl({ to: value });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:pt-[1.125rem]">
          {filterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 rounded-sm border border-border px-3 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              Clear
            </button>
          ) : null}
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
