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
import type { ComponentType, SVGProps } from 'react';

import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { DueDateDisplay } from '@/components/due-date-display';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { PageHeader } from '@/components/page-header';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { chatViewLabel } from '@/lib/chat-view';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { selectedValues } from '@/lib/filter-values';
import { fetchGlobalSearch } from '@/lib/global-search';
import { GLOBAL_SEARCH_SOURCE_OPTIONS } from '@/lib/global-search-sources';
import { searchErrorMessage } from '@/lib/ux-errors';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface SearchViewState {
  loading: boolean;
  results: GlobalSearchResult[];
  warnings: string[];
  error: string | null;
  searchVersion: number;
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
  | { type: 'search_error'; error: string }
  | { type: 'search_retry' };

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

const RESULT_TYPE_OPTIONS: { value: string; label: string }[] = [];
const FILTERS_BY_PARAM = new Map<string, (typeof FILTERS)[number]>();
for (const filter of FILTERS) {
  FILTERS_BY_PARAM.set(filter.param, filter);
  if (filter.kinds) RESULT_TYPE_OPTIONS.push({ value: filter.param, label: filter.label });
}
const SOURCE_OPTIONS = GLOBAL_SEARCH_SOURCE_OPTIONS;

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
  if (action.type === 'search_retry') {
    return { ...state, searchVersion: state.searchVersion + 1 };
  }
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
      <span className="mb-1 block text-[11px] text-fg-dim">{label}</span>
      <input
        type="date"
        value={value}
        aria-label={label}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-base font-mono text-fg outline-none transition-colors focus-visible:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:text-xs"
      />
    </label>
  );
}

function SearchResultRow({ result }: { result: GlobalSearchResult }) {
  const Icon = iconFor(result.kind);
  const date = resultDate(result);
  const relatedEvidence = relatedEvidenceLabel(result);
  const objectType = typeof result.metadata?.type === 'string' ? result.metadata.type : '';
  const dueAt = typeof result.metadata?.dueAt === 'string' ? result.metadata.dueAt : null;
  const title = result.externalHref ? (
    <a
      href={result.externalHref}
      target="_blank"
      rel="noreferrer"
      className="block truncate hover:underline"
    >
      {result.title}
    </a>
  ) : (
    <Link href={result.href} className="block truncate hover:underline">
      {result.title}
    </Link>
  );
  const row = (
    <CollectionRow
      className="min-h-13"
      leading={<Icon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />}
      title={title}
      context={result.snippet}
      metadata={
        <>
          <span className="text-[11px] text-fg-dim">{kindLabel(result.kind)}</span>
          {date ? <span>{date}</span> : null}
          {result.metadata?.source ? <span>{result.metadata.source}</span> : null}
          {result.metadata?.type ? <span>{result.metadata.type}</span> : null}
          {isSchedulableObjectType(objectType) ? (
            <DueDateDisplay value={dueAt} variant="compact" />
          ) : null}
          {relatedEvidence ? (
            <span className="truncate text-[11px] text-fg-dim">Evidence · {relatedEvidence}</span>
          ) : null}
        </>
      }
      actions={
        result.externalHref ? (
          <ExternalLink aria-hidden="true" className="size-4 text-fg-dim" />
        ) : result.pinTarget ? (
          <ItemActionGroup label={`Actions for ${result.title}`}>
            <PinOverflowMenu
              target={result.pinTarget}
              title={result.title}
              initialPinned={result.pinned ?? false}
            />
          </ItemActionGroup>
        ) : null
      }
    />
  );

  return <li>{row}</li>;
}

function SearchResultsLoading() {
  return (
    <div className="space-y-3 px-3 py-4" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="space-y-2 border-b border-border pb-3 last:border-b-0">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
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
    searchVersion: 0,
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
  }, [kinds, selectedSources, state.from, state.query, state.searchVersion, state.to]);

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

  function submitSearch(): void {
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
  const hasSearchCriteria = Boolean(state.query || filterCount > 0);
  const resultStatus = state.loading
    ? 'Searching…'
    : state.error
      ? 'Search unavailable'
      : `${state.results.length} results`;

  const searchHref = searchPath({
    query: state.query,
    typeFilters: state.typeFilters,
    source: state.source,
    from: state.from,
    to: state.to,
  });

  return (
    <div className="space-y-5">
      {state.query ? (
        <ChatViewContextBinder
          viewKey={`search:${state.query}`}
          kind="page"
          href={searchHref}
          label={chatViewLabel(`Search: ${state.query}`, 'Search')}
        />
      ) : null}
      <PageHeader
        variant="collection"
        title="Search"
        subtitle="Search pages, workspace objects, tasks, boards, calendar, timeline events, and documents."
      />

      <form action={submitSearch}>
        <CollectionToolbar
          count={resultStatus}
          search={
            <div className="relative">
              <label htmlFor="global-search-query" className="sr-only">
                Search everything
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-dim"
              />
              <input
                id="global-search-query"
                type="search"
                aria-label="Search everything"
                value={state.draft}
                onChange={(event) => {
                  dispatch({ type: 'draft', value: event.target.value });
                }}
                placeholder="Search everything"
                className="h-9 w-full rounded-sm border-0 bg-transparent pl-10 pr-24 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 sm:text-sm"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 h-8 -translate-y-1/2 rounded-sm px-3 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                Search
              </button>
            </div>
          }
          filters={
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
          }
          activeFilters={[
            ...(state.typeFilters
              ? [
                  {
                    key: 'type',
                    label: 'Type',
                    value: state.typeFilters,
                    onRemove: () => {
                      dispatch({ type: 'type_filters', value: '' });
                      replaceSearchUrl({ typeFilters: '' });
                    },
                  },
                ]
              : []),
            ...(state.source
              ? [
                  {
                    key: 'source',
                    label: 'Source',
                    value: state.source,
                    onRemove: () => {
                      dispatch({ type: 'source', value: '' });
                      replaceSearchUrl({ source: '' });
                    },
                  },
                ]
              : []),
            ...(state.from
              ? [
                  {
                    key: 'from',
                    label: 'From',
                    value: state.from,
                    onRemove: () => {
                      dispatch({ type: 'from', value: '' });
                      replaceSearchUrl({ from: '' });
                    },
                  },
                ]
              : []),
            ...(state.to
              ? [
                  {
                    key: 'to',
                    label: 'To',
                    value: state.to,
                    onRemove: () => {
                      dispatch({ type: 'to', value: '' });
                      replaceSearchUrl({ to: '' });
                    },
                  },
                ]
              : []),
          ]}
          actions={
            filterCount > 0 ? (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 rounded-sm border border-border px-3 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                Clear
              </button>
            ) : null
          }
        />
      </form>

      {state.warnings.length > 0 ? (
        <div className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
          {state.warnings.join(' ')}
        </div>
      ) : null}

      <SearchResultsPanel
        resultStatus={resultStatus}
        loading={state.loading}
        error={state.error}
        results={state.results}
        hasSearchCriteria={hasSearchCriteria}
        onRetry={() => {
          dispatch({ type: 'search_retry' });
        }}
      />
    </div>
  );
}

function SearchResultsPanel({
  resultStatus,
  loading,
  error,
  results,
  hasSearchCriteria,
  onRetry,
}: {
  resultStatus: string;
  loading: boolean;
  error: string | null;
  results: GlobalSearchResult[];
  hasSearchCriteria: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="search-results-heading"
      className="overflow-hidden border-x border-border bg-bg"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 id="search-results-heading" className="sr-only">
          Search results
        </h2>
        <p aria-live="polite" className="text-xs text-fg-dim">
          {resultStatus}
        </p>
        {loading ? (
          <Loader2
            aria-hidden="true"
            className="size-4 animate-spin text-fg-dim motion-reduce:animate-none"
          />
        ) : null}
      </div>
      {error ? (
        <div role="alert" className="space-y-3 px-3 py-8">
          <p className="text-sm text-danger">Unable to search. {error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-9 rounded-sm border border-border px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Try search again
          </button>
        </div>
      ) : loading && results.length === 0 ? (
        <SearchResultsLoading />
      ) : results.length === 0 && !loading ? (
        <div className="px-3 py-8">
          <p className="text-sm font-medium text-fg">
            {hasSearchCriteria ? 'No matches found' : 'Start with a search'}
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {hasSearchCriteria
              ? 'Try different words or adjust the filters.'
              : 'Enter words, then narrow results by type, source, or date.'}
          </p>
        </div>
      ) : (
        <ul>
          {results.map((result) => (
            <SearchResultRow key={result.id} result={result} />
          ))}
        </ul>
      )}
    </section>
  );
}
