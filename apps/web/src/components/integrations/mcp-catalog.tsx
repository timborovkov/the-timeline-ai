'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState } from 'react';

import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
}

const INITIAL_CARD_STATE: CatalogCardState = {
  open: false,
  bearer: '',
  headerName: '',
  headerValue: '',
  busy: false,
};

function patchCardState(
  state: CatalogCardState,
  patch: Partial<CatalogCardState>,
): CatalogCardState {
  return { ...state, ...patch };
}

/**
 * One-click connect catalog for curated MCP servers. Each card knows its
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
        <p className="text-sm text-fg-muted">No MCP servers match this filter.</p>
      ) : (
        <div className="grid auto-rows-fr gap-3 md:grid-cols-2">
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
  const dialog = useAppDialog();
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
  const [{ open, bearer, headerName, headerValue, busy }, setCardState] = useReducer(
    patchCardState,
    INITIAL_CARD_STATE,
  );

  async function connect(body: Record<string, unknown>) {
    setCardState({ busy: true });
    try {
      const res = await fetch('/api/team/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogId: entry.id, ...body }),
      });
      if (!res.ok) {
        await dialog.alert({ title: 'Connect failed', description: await res.text() });
        return;
      }
      const data = (await res.json()) as { id: string; needsOauth?: boolean };
      if (data.needsOauth && data.id) {
        const oauth = await fetch('/api/mcp/oauth/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mcpServerId: data.id }),
        });
        if (!oauth.ok) {
          await dialog.alert({ title: 'OAuth start failed', description: await oauth.text() });
          router.refresh();
          return;
        }
        const oauthData = (await oauth.json()) as { url?: string; error?: string };
        if (oauthData.url) {
          window.location.href = oauthData.url;
          return;
        }
        await dialog.alert({
          title: 'OAuth start failed',
          description: oauthData.error ?? 'unknown',
        });
      }
      router.refresh();
    } finally {
      setCardState({ busy: false });
    }
  }

  async function onClickConnect() {
    if (!isConnectable) return;
    if (entry.authType === 'none' || entry.authType === 'oauth') {
      await connect({});
      return;
    }
    setCardState({ open: !open });
  }

  async function submitToken() {
    if (entry.authType === 'bearer') {
      if (!bearer) {
        await dialog.alert({ title: 'Token required', description: 'Enter a bearer token.' });
        return;
      }
      await connect({ bearerToken: bearer });
    } else if (entry.authType === 'header') {
      if (!headerName || !headerValue) {
        await dialog.alert({
          title: 'Header required',
          description: 'Enter both a header name and value.',
        });
        return;
      }
      await connect({ header: { name: headerName, value: headerValue } });
    }
    setCardState({ open: false });
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center gap-3">
        <Image
          src={entry.logo}
          alt=""
          width={28}
          height={28}
          className="size-7 rounded-sm bg-surface-2 p-1"
        />
        <CardTitle className="text-sm font-medium">{entry.label}</CardTitle>
        <span className="ml-auto rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-fg-muted">
          {entry.category}
        </span>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <p className="text-sm text-fg-muted">{entry.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-fg-muted">
            {statusLabel}
          </span>
          {entry.ingestStatus === 'coming_soon' ? (
            <span className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Native ingest planned
            </span>
          ) : null}
        </div>
        {entry.authHint && isConnectable ? (
          <p className="mt-2 text-xs text-fg-dim">{entry.authHint}</p>
        ) : null}

        {open && entry.authType === 'bearer' ? (
          <div className="mt-3 space-y-2">
            <Label htmlFor={`bearer-${entry.id}`}>Bearer token</Label>
            <Input
              id={`bearer-${entry.id}`}
              type="password"
              value={bearer}
              onChange={(e) => {
                setCardState({ bearer: e.target.value });
              }}
            />
          </div>
        ) : null}
        {open && entry.authType === 'header' ? (
          <div className="mt-3 space-y-2">
            <div>
              <Label htmlFor={`hn-${entry.id}`}>Header name</Label>
              <Input
                id={`hn-${entry.id}`}
                value={headerName}
                onChange={(e) => {
                  setCardState({ headerName: e.target.value });
                }}
              />
            </div>
            <div>
              <Label htmlFor={`hv-${entry.id}`}>Header value</Label>
              <Input
                id={`hv-${entry.id}`}
                type="password"
                value={headerValue}
                onChange={(e) => {
                  setCardState({ headerValue: e.target.value });
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-3">
          {open && (entry.authType === 'bearer' || entry.authType === 'header') ? (
            <>
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
                  setCardState({ open: false });
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
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
          <span className="ml-auto text-[11px] text-fg-dim">{entry.authType ?? 'planned'}</span>
        </div>
      </CardContent>
      {dialog.node}
    </Card>
  );
}
