'use client';

import { useState, type SyntheticEvent } from 'react';

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
 */
export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const q = query.trim();
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

  function clear(): void {
    setQuery('');
    setResults(null);
    setError(null);
  }

  return (
    <section className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Semantic search</span>
          <input
            type="search"
            placeholder='e.g. "licensing discussion with Apple"'
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={loading || query.trim().length === 0}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
        {results !== null && (
          <button
            type="button"
            onClick={clear}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            Clear
          </button>
        )}
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
                No matches. Try a different phrasing — semantic search finds events by meaning,
                not exact words.
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
                          href={`/app/entities/${id}`}
                          className="rounded-full border border-input px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
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
