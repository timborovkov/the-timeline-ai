'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { networkActionError, readPublicApiError } from '@/lib/client-api-error';
import { notifyAction } from '@/lib/notify';

interface CatalogEntryProps {
  id: string;
  label: string;
  description: string;
  logo: string;
  category: string;
  authType: 'none' | 'oauth' | 'bearer' | 'header' | null;
  authHint: string | null;
  status: string;
  ingestStatus: string;
}

const FILTER_THRESHOLD = 4;

interface CatalogCardState {
  open: boolean;
  bearer: string;
  headerName: string;
  headerValue: string;
  busy: boolean;
  fieldError: string | null;
}

const INITIAL_CARD_STATE: CatalogCardState = {
  open: false,
  bearer: '',
  headerName: '',
  headerValue: '',
  busy: false,
  fieldError: null,
};

function patchCardState(
  state: CatalogCardState,
  patch: Partial<CatalogCardState>,
): CatalogCardState {
  return { ...state, ...patch };
}

/**
 * One-click connect catalog for curated MCP servers. Each row knows its
 * pre-baked URL + auth type server-side (sourced from
 * `integrations.listCatalog()`); the client just posts the catalogId
 * (and a bearer token / header value when the entry needs one) to
 * /api/team/mcp-servers, then optionally kicks the OAuth start.
 *
 * Filter / search chrome surfaces once the catalog grows past
 * FILTER_THRESHOLD entries — there's no value in chrome for a 3-entry
 * grid.
 */
export function McpCatalog({
  entries,
  localConnectionsEnabled = false,
}: {
  entries: CatalogEntryProps[];
  localConnectionsEnabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entries) seen.add(e.category);
    return Array.from(seen).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeCategory && e.category !== activeCategory) return false;
      if (!q) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    });
  }, [entries, query, activeCategory]);

  const showFilters = entries.length >= FILTER_THRESHOLD;

  return (
    <div className="space-y-3">
      {showFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="mcp-catalog-filter">
            Filter MCP servers
          </label>
          <input
            id="mcp-catalog-filter"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Filter MCP servers…"
            className="h-9 w-48 rounded-sm border border-border bg-surface-2 px-2 text-xs"
          />
          {categories.map((cat) => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setActiveCategory(active ? null : cat);
                }}
                className={
                  active
                    ? 'min-h-9 rounded-sm border border-signal bg-signal/10 px-1.5 py-0.5 text-[11px] text-signal outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2'
                    : 'min-h-9 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[11px] text-fg-muted outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2'
                }
              >
                {cat}
              </button>
            );
          })}
          {query || activeCategory ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setActiveCategory(null);
              }}
              className="min-h-9 rounded-sm px-1.5 text-xs text-fg-dim outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
            >
              Clear filters
            </button>
          ) : null}
          <output className="ml-auto text-[11px] text-fg-dim" aria-live="polite" aria-atomic="true">
            {filtered.length} of {entries.length} MCP servers
          </output>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="border-y border-border py-4 text-sm text-fg-muted">
          No MCP servers match this filter.
        </p>
      ) : (
        <div>
          {filtered.map((e) => (
            <CatalogCard key={e.id} entry={e} localConnectionsEnabled={localConnectionsEnabled} />
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogCard({
  entry,
  localConnectionsEnabled,
}: {
  entry: CatalogEntryProps;
  localConnectionsEnabled: boolean;
}) {
  const router = useRouter();
  const isConnectable =
    (entry.status === 'mcp_available' ||
      (entry.status === 'mcp_local' && localConnectionsEnabled)) &&
    entry.authType !== null;
  const statusLabel =
    entry.status === 'coming_soon'
      ? 'Coming soon'
      : entry.status === 'mcp_local'
        ? 'Local desktop only'
        : entry.ingestStatus === 'coming_soon'
          ? 'MCP now'
          : 'Available';
  const [{ open, bearer, headerName, headerValue, busy, fieldError }, setCardState] = useReducer(
    patchCardState,
    INITIAL_CARD_STATE,
  );

  async function connect(body: Record<string, unknown>) {
    setCardState({ busy: true, fieldError: null });
    const outcome = { success: 'Server connected' };
    const result = await notifyAction({
      id: `mcp-catalog:${entry.id}:connect`,
      loading: 'Connecting…',
      get success() {
        return outcome.success;
      },
      error: 'Couldn’t connect server',
      run: async () => {
        const res = await fetch('/api/team/mcp-servers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ catalogId: entry.id, ...body }),
        });
        if (!res.ok)
          return {
            error: await readPublicApiError(res, networkActionError('connect this server')),
          };
        const data = (await res.json()) as { id: string; needsOauth?: boolean };
        if (data.needsOauth && data.id) {
          try {
            const oauth = await fetch('/api/mcp/oauth/start', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ mcpServerId: data.id }),
            });
            const oauthData = oauth.ok
              ? ((await oauth.json().catch(() => null)) as { url?: string } | null)
              : null;
            if (oauthData?.url) {
              window.location.href = oauthData.url;
              return { ok: true };
            }
          } catch {
            // The server was created, so OAuth failure is recoverable from its Connect action.
          }
          outcome.success = 'Server added. Connect it again to finish authorization.';
        }
        return { ok: true };
      },
    });
    setCardState({ busy: false, open: result.error ? open : false, fieldError: null });
    if (result.error) return;
    router.refresh();
  }

  async function onClickConnect() {
    if (!isConnectable) return;
    if (entry.authType === 'none' || entry.authType === 'oauth') {
      await connect({});
      return;
    }
    setCardState({ open: !open, fieldError: null });
  }

  async function submitToken() {
    if (entry.authType === 'bearer') {
      if (!bearer) {
        setCardState({ fieldError: 'Enter a bearer token.' });
        return;
      }
      await connect({ bearerToken: bearer });
    } else if (entry.authType === 'header') {
      if (!headerName || !headerValue) {
        setCardState({ fieldError: 'Enter both a header name and value.' });
        return;
      }
      await connect({ header: { name: headerName, value: headerValue } });
    }
  }

  return (
    <div>
      <CollectionRow>
        <CollectionRow.Leading>
          <Image
            src={entry.logo}
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-sm bg-surface-2 p-1"
          />
        </CollectionRow.Leading>
        <CollectionRow.Title>{entry.label}</CollectionRow.Title>
        <CollectionRow.Context>{entry.description}</CollectionRow.Context>
        <CollectionRow.Metadata>
          <>
            <span className="text-[11px] text-fg-dim">{statusLabel}</span>
            <span className="text-[11px] text-fg-dim">{entry.category}</span>
            {entry.ingestStatus === 'coming_soon' ? (
              <span className="text-[11px] text-fg-dim">Native ingest planned</span>
            ) : null}
          </>
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          {open && (entry.authType === 'bearer' || entry.authType === 'header') ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  void submitToken();
                }}
              >
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCardState({ open: false, fieldError: null });
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant={isConnectable ? 'default' : 'outline'}
              disabled={busy || !isConnectable}
              onClick={() => {
                void onClickConnect();
              }}
            >
              {!isConnectable
                ? entry.status === 'mcp_local'
                  ? 'Local setup only'
                  : 'Coming soon'
                : busy
                  ? 'Connecting…'
                  : entry.authType === 'oauth'
                    ? 'Connect with OAuth'
                    : entry.authType === 'none'
                      ? 'Connect'
                      : 'Connect with token'}
            </Button>
          )}
        </CollectionRow.Actions>
      </CollectionRow>
      {entry.authHint && isConnectable ? (
        <p className="px-3 pb-2 text-xs text-fg-dim">{entry.authHint}</p>
      ) : null}
      {open && entry.authType === 'bearer' ? (
        <div className="space-y-2 px-3 pb-3">
          <Label htmlFor={`bearer-${entry.id}`}>Bearer token</Label>
          <Input
            id={`bearer-${entry.id}`}
            type="password"
            value={bearer}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? `bearer-error-${entry.id}` : undefined}
            onChange={(e) => {
              setCardState({ bearer: e.target.value, fieldError: null });
            }}
          />
          {fieldError ? (
            <p id={`bearer-error-${entry.id}`} role="alert" className="text-xs text-danger">
              {fieldError}
            </p>
          ) : null}
        </div>
      ) : null}
      {open && entry.authType === 'header' ? (
        <div className="space-y-2 px-3 pb-3">
          <div>
            <Label htmlFor={`hn-${entry.id}`}>Header name</Label>
            <Input
              id={`hn-${entry.id}`}
              value={headerName}
              onChange={(e) => {
                setCardState({ headerName: e.target.value, fieldError: null });
              }}
            />
          </div>
          <div>
            <Label htmlFor={`hv-${entry.id}`}>Header value</Label>
            <Input
              id={`hv-${entry.id}`}
              type="password"
              value={headerValue}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? `header-error-${entry.id}` : undefined}
              onChange={(e) => {
                setCardState({ headerValue: e.target.value, fieldError: null });
              }}
            />
          </div>
          {fieldError ? (
            <p id={`header-error-${entry.id}`} role="alert" className="text-xs text-danger">
              {fieldError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
