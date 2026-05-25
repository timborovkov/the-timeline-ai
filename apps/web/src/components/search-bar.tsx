'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

import { Card, CardContent } from '@/components/ui/card';

interface SearchResult {
  eventId: string;
  factIds: string[];
  score: number;
  occurredAt: string;
  source: 'web' | 'telegram' | 'email' | 'system';
  authorUserId: string | null;
  entityIds: string[];
  snippet: string;
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  results?: SearchResult[];
  count?: number;
}

/**
 * Phase 5 semantic search bar. Mounted above the timeline filter form;
 * empty query renders nothing (the existing reverse-chron timeline shows
 * underneath). Non-empty queries POST to /api/search and render result
 * cards. Streaming is intentionally not implemented here — Phase 6.
 *
 * `initialQuery` prefills the input AND auto-runs the search on mount.
 * Used by the ⌘K command bar route `/app/timeline?q=…` so submitting a
 * query from anywhere in the app lands on the timeline with results
 * already rendered. Auto-search runs once per mounted instance, even if
 * the prop is later cleared, so the user can still erase and retry.
 */
interface Props {
  initialQuery?: string;
}

export function SearchBar({ initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRanRef = useRef<string | null>(null);

  async function runSearch(raw: string): Promise<void> {
    const q = raw.trim();
    if (!q) {
      setResults(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) {
        if (data.error === 'search_unconfigured') {
          setError(
            'Search is not configured for this environment (missing OPENROUTER_API_KEY or QDRANT_URL).',
          );
        } else if (data.error === 'embed_failed') {
          setError('Could not embed your query. Try again in a moment.');
        } else if (data.error === 'qdrant_failed') {
          setError('Vector store is unreachable. Try again in a moment.');
        } else {
          setError(data.error ?? `Search failed (${String(res.status)}).`);
        }
        setResults(null);
        return;
      }
      setResults(data.results ?? []);
    } catch (err) {
      console.error('[search] request failed', err);
      setError('Network error while searching.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    await runSearch(query);
  }

  // Auto-run search when arriving from the command bar (`?q=…`), and
  // re-run whenever the prop changes to a new non-empty value (e.g. the
  // user submits the ⌘K bar a second time with a different query while
  // already on the timeline). `lastAutoRanRef` tracks the last value
  // we've auto-run so we don't fight the user mid-typing: if they edit
  // the input after auto-search lands, our local `query` state diverges
  // from `initialQuery` and we leave it alone.
  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (!trimmed) return;
    if (autoRanRef.current === trimmed) return;
    autoRanRef.current = trimmed;
    setQuery(initialQuery);
    void runSearch(initialQuery);
  }, [initialQuery]);

  function clear(): void {
    setQuery('');
    setResults(null);
    setError(null);
  }

  return (
    <section className="space-y-3">
      <form onSubmit={onSubmit} className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder='Semantic search — e.g. "licensing discussion with Apple"'
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          className="h-11 w-full rounded-sm border border-border bg-surface pl-10 pr-28 text-sm transition-colors focus:border-border-strong focus:outline-none"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {results !== null && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="grid size-8 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={loading || query.trim().length === 0}
            className="h-8 rounded-sm px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {results !== null && !error && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                No matches. Try a different phrasing — semantic search finds events by meaning, not
                exact words.
              </CardContent>
            </Card>
          ) : (
            results.map((r) => (
              <Card key={r.eventId}>
                <CardContent className="space-y-1 py-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(r.occurredAt))}{' '}
                      · {r.source}
                    </span>
                    <span>score {r.score.toFixed(3)}</span>
                  </div>
                  <p className="leading-snug">{r.snippet}</p>
                  {r.entityIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {r.entityIds.map((id) => (
                        <a
                          key={id}
                          href={`/app/objects/${id}`}
                          className="rounded-sm border border-border bg-bg px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted hover:border-border-strong hover:text-fg"
                        >
                          entity
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </section>
  );
}
