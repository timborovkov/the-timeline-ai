'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
  authType: 'none' | 'oauth' | 'bearer' | 'header';
  authHint: string | null;
  status: string;
}

/**
 * One-click connect catalog for curated MCP servers. Each card knows its
 * pre-baked URL + auth type server-side (sourced from
 * `integrations.listCatalog()`); the client just posts the catalogId
 * (and a bearer token / header value when the entry needs one) to
 * /api/team/mcp-servers, then optionally kicks the OAuth start.
 */
export function McpCatalog({ entries }: { entries: CatalogEntryProps[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {entries.map((e) => (
        <CatalogCard key={e.id} entry={e} />
      ))}
    </div>
  );
}

function CatalogCard({ entry }: { entry: CatalogEntryProps }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bearer, setBearer] = useState('');
  const [headerName, setHeaderName] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/team/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogId: entry.id, ...body }),
      });
      if (!res.ok) {
        alert(`Connect failed: ${await res.text()}`);
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
          alert(`OAuth start failed: ${await oauth.text()}`);
          router.refresh();
          return;
        }
        const oauthData = (await oauth.json()) as { url?: string; error?: string };
        if (oauthData.url) {
          window.location.href = oauthData.url;
          return;
        }
        alert(`OAuth start failed: ${oauthData.error ?? 'unknown'}`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onClickConnect() {
    if (entry.authType === 'none' || entry.authType === 'oauth') {
      await connect({});
      return;
    }
    setOpen((v) => !v);
  }

  async function submitToken() {
    if (entry.authType === 'bearer') {
      if (!bearer) {
        alert('Token required');
        return;
      }
      await connect({ bearerToken: bearer });
    } else if (entry.authType === 'header') {
      if (!headerName || !headerValue) {
        alert('Header name + value required');
        return;
      }
      await connect({ header: { name: headerName, value: headerValue } });
    }
    setOpen(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <img
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
      <CardContent className="space-y-3">
        <p className="text-sm text-fg-muted">{entry.description}</p>
        {entry.authHint ? <p className="text-xs text-fg-dim">{entry.authHint}</p> : null}

        {open && entry.authType === 'bearer' ? (
          <div className="space-y-2">
            <Label htmlFor={`bearer-${entry.id}`}>Bearer token</Label>
            <Input
              id={`bearer-${entry.id}`}
              type="password"
              value={bearer}
              onChange={(e) => {
                setBearer(e.target.value);
              }}
            />
          </div>
        ) : null}
        {open && entry.authType === 'header' ? (
          <div className="space-y-2">
            <div>
              <Label htmlFor={`hn-${entry.id}`}>Header name</Label>
              <Input
                id={`hn-${entry.id}`}
                value={headerName}
                onChange={(e) => {
                  setHeaderName(e.target.value);
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
                  setHeaderValue(e.target.value);
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
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
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                void onClickConnect();
              }}
            >
              {busy
                ? 'Connecting…'
                : entry.authType === 'oauth'
                  ? 'Connect with OAuth'
                  : entry.authType === 'none'
                    ? 'Connect'
                    : 'Connect with token'}
            </Button>
          )}
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
            {entry.authType}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
