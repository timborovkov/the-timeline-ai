'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function McpShareUi({ keys }: { keys: KeyRow[] }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [mintedKey, setMintedKey] = useState<{ name: string; plaintext: string } | null>(null);
  const [mcpUrl, setMcpUrl] = useState('');

  useEffect(() => {
    // Compute the absolute MCP endpoint URL on the client so it matches
    // whatever origin the user is browsing under (localhost, staging,
    // prod). Server-side rendering doesn't know about origin without
    // forwarding headers, and getting that wrong gives the user a
    // copy-paste URL that doesn't work.
    setMcpUrl(`${window.location.origin}/api/mcp/server`);
  }, []);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/team/mcp-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        alert(`Create failed: ${await res.text()}`);
        return;
      }
      const data = (await res.json()) as { name: string; plaintext: string };
      setMintedKey({ name: data.name, plaintext: data.plaintext });
      setName('');
      setShowCreate(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, label: string) {
    if (!confirm(`Revoke "${label}"? Any agent using this key will lose access immediately.`)) {
      return;
    }
    await fetch(`/api/team/mcp-keys/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">MCP endpoint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-muted">
            Configure your MCP client (Claude Desktop, Cursor, Vernix, etc.) with the URL
            below plus a bearer key from this page. The server speaks MCP protocol{' '}
            <code className="font-mono">2024-11-05</code> over streamable HTTP.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-sm border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs">
              {mcpUrl || 'Loading…'}
            </code>
            <Button
              size="sm"
              variant="ghost"
              disabled={!mcpUrl}
              onClick={() => {
                copy(mcpUrl);
              }}
            >
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>

      {mintedKey ? (
        <Card className="border-signal/40">
          <CardHeader>
            <CardTitle className="text-sm">
              New key — copy now, you won&apos;t see it again
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">
              The plaintext for <span className="font-mono">{mintedKey.name}</span> is shown
              below once. We store only the hash; if you lose it you&apos;ll need to mint a
              new one.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-sm border border-signal/40 bg-surface-2 px-2 py-1.5 font-mono text-xs">
                {mintedKey.plaintext}
              </code>
              <Button
                size="sm"
                onClick={() => {
                  copy(mintedKey.plaintext);
                }}
              >
                Copy
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMintedKey(null);
              }}
            >
              I&apos;ve copied it, dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
          Active keys ({keys.length})
        </div>
        <Button
          size="sm"
          onClick={() => {
            setShowCreate((v) => !v);
          }}
        >
          {showCreate ? 'Cancel' : 'New key'}
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="space-y-1">
              <Label>Label</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="Claude Desktop · personal mac"
              />
            </div>
            <Button size="sm" disabled={busy || !name} onClick={() => void create()}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {keys.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No active keys. Create one to let an external agent read this team&apos;s timeline.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{k.name}</div>
                <div className="font-mono text-xs text-fg-muted">
                  {k.prefix}… · created {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt
                    ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                    : ' · never used'}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void revoke(k.id, k.name);
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
