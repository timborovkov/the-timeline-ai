'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  authType: string;
  enabled: boolean;
  cachedTools: { name: string; description?: string }[];
  disabledTools: string[];
  toolsCachedAt: string | null;
  lastError: string | null;
}

type AuthType = 'none' | 'bearer' | 'header' | 'basic' | 'url_key' | 'oauth';

export function McpServersUi({ servers }: { servers: McpServerRow[] }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>('none');
  const [token, setToken] = useState('');
  const [headerName, setHeaderName] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name, url, authType };
      if (authType === 'bearer') body.authConfig = { token };
      else if (authType === 'header') body.authConfig = { name: headerName, value: headerValue };
      const res = await fetch('/api/team/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        alert(`Add failed: ${text}`);
        return;
      }
      setName('');
      setUrl('');
      setAuthType('none');
      setToken('');
      setHeaderName('');
      setHeaderValue('');
      setShowAdd(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(server: McpServerRow) {
    await fetch(`/api/team/mcp-servers/${server.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    router.refresh();
  }

  async function remove(server: McpServerRow) {
    if (!confirm(`Remove ${server.name}?`)) return;
    await fetch(`/api/team/mcp-servers/${server.id}`, { method: 'DELETE' });
    router.refresh();
  }

  async function startOAuth(server: McpServerRow) {
    const res = await fetch('/api/mcp/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mcpServerId: server.id }),
    });
    if (!res.ok) {
      alert(`OAuth start failed: ${await res.text()}`);
      return;
    }
    const data = (await res.json()) as { url?: string; error?: string };
    if (data.url) window.location.href = data.url;
    else alert(`OAuth start failed: ${data.error ?? 'unknown'}`);
  }

  async function testCall(server: McpServerRow, toolName: string) {
    const namespaced = `mcp__${server.id.replace(/-/g, '')}__${toolName}`;
    const argsRaw = prompt(`Args (JSON) for ${toolName}:`, '{}');
    if (argsRaw === null) return;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsRaw) as Record<string, unknown>;
    } catch {
      alert('Invalid JSON');
      return;
    }
    const res = await fetch(`/api/team/mcp-servers/${server.id}/tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: namespaced, args }),
    });
    const text = await res.text();
    alert(text);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">
          Connect custom MCP servers to bring their tools into the agent. Tools are namespaced so
          two servers exposing the same name can coexist.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setShowAdd((s) => !s);
          }}
        >
          {showAdd ? 'Cancel' : 'Add server'}
        </Button>
      </div>

      {showAdd ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">New MCP server</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Display name</Label>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                  placeholder="Context7"
                />
              </div>
              <div className="space-y-1">
                <Label>URL</Label>
                <Input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                  }}
                  placeholder="https://mcp.example.com/mcp"
                />
              </div>
              <div className="space-y-1">
                <Label>Auth type</Label>
                <select
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  value={authType}
                  onChange={(e) => {
                    setAuthType(e.target.value as AuthType);
                  }}
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="header">Custom header</option>
                  <option value="oauth">OAuth (coming soon)</option>
                </select>
              </div>
              {authType === 'bearer' ? (
                <div className="space-y-1">
                  <Label>Token</Label>
                  <Input
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                    }}
                  />
                </div>
              ) : null}
              {authType === 'header' ? (
                <>
                  <div className="space-y-1">
                    <Label>Header name</Label>
                    <Input
                      value={headerName}
                      onChange={(e) => {
                        setHeaderName(e.target.value);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Header value</Label>
                    <Input
                      type="password"
                      value={headerValue}
                      onChange={(e) => {
                        setHeaderValue(e.target.value);
                      }}
                    />
                  </div>
                </>
              ) : null}
            </div>
            <Button size="sm" disabled={busy || !name || !url} onClick={() => void submit()}>
              {busy ? 'Adding…' : 'Add'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {servers.length === 0 ? (
        <p className="text-sm text-fg-muted">No custom MCP servers connected.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {servers.map((s) => (
            <li key={s.id} className="space-y-2 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
                  {s.authType}
                </span>
                {!s.enabled ? (
                  <span className="rounded-sm border border-border px-1 text-[10px] uppercase text-fg-muted">
                    Disabled
                  </span>
                ) : null}
                <div className="ml-auto flex gap-2">
                  {s.authType === 'oauth' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void startOAuth(s);
                      }}
                    >
                      Connect
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void toggleEnabled(s);
                    }}
                  >
                    {s.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void remove(s);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <div className="break-all text-xs text-fg-muted">{s.url}</div>
              {s.lastError ? (
                <div className="text-xs text-destructive">Error: {s.lastError}</div>
              ) : null}
              {s.cachedTools.length > 0 ? (
                <div className="space-y-1">
                  <div className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
                    Tools ({s.cachedTools.length})
                  </div>
                  <ul className="space-y-1">
                    {s.cachedTools.map((t) => (
                      <li key={t.name} className="flex items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-mono">{t.name}</span>
                          {t.description ? (
                            <span className="ml-2 text-fg-muted">— {t.description}</span>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void testCall(s, t.name);
                          }}
                        >
                          Test call
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-xs text-fg-muted">No tools cached yet.</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
