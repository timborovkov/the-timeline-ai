'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useReducer, useRef, useState } from 'react';

import { CopyButton } from '@/components/copy-button';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { networkActionError, readPublicApiError } from '@/lib/client-api-error';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

function remoteJsonConfig(mcpUrl: string, mintedKey: MintedKey): string {
  return JSON.stringify(
    {
      mcpServers: {
        timeline: {
          type: 'streamable-http',
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${mintedKey.plaintext}`,
          },
        },
      },
    },
    null,
    2,
  );
}

function codexCommand(mcpUrl: string, mintedKey: MintedKey): string {
  return [
    `export TIMELINE_MCP_KEY="${mintedKey.plaintext}"`,
    `codex mcp add timeline --url "${mcpUrl}" --bearer-token-env-var TIMELINE_MCP_KEY`,
  ].join('\n');
}

function chatGptConnectorDetails(mcpUrl: string): string {
  return [
    'Settings -> Apps & Connectors -> Advanced settings -> Developer mode',
    'Create app / connector',
    'Connector name: Timeline',
    `Connector URL: ${mcpUrl}`,
    'Protocol: Streaming HTTP / Streamable HTTP',
  ].join('\n');
}

interface MintedKey {
  name: string;
  plaintext: string;
}
interface McpShareState {
  showCreate: boolean;
  name: string;
  busy: boolean;
  mintedKey: MintedKey | null;
  mcpUrl: string;
}

function patchMcpShareState(state: McpShareState, patch: Partial<McpShareState>): McpShareState {
  return { ...state, ...patch };
}

function McpStatusGrid() {
  return (
    <section className="grid gap-3 md:grid-cols-4">
      {[
        ['Transport', 'Streamable HTTP URL', 'Use the URL below, not an SSE endpoint.'],
        ['Protocol', '2024-11-05', 'Compatibility target returned during initialize.'],
        ['Auth', 'Bearer header', 'Keys are team-scoped and can be revoked here.'],
        ['Visibility', 'Team-visible only', 'Private and specific-user events stay out.'],
      ].map(([label, value, description]) => (
        <div key={label} className="rounded-sm border border-border bg-surface p-3">
          <div className="text-[11px] text-fg-muted">{label}</div>
          <div className="mt-1 text-sm font-medium text-fg">{value}</div>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{description}</p>
        </div>
      ))}
    </section>
  );
}

function McpEndpointCard({ mcpUrl }: { mcpUrl: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">MCP endpoint</CardTitle>
          <Badge variant="outline" className="rounded-sm ">
            Streamable HTTP
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-fg-muted">
          Configure a remote MCP client with this URL plus a bearer key from this page. Pick
          Streamable HTTP or HTTP URL in clients that ask for a transport. Do not choose legacy SSE;
          Timeline does not expose an <code className="font-mono">/sse</code> endpoint.
        </p>
        <p className="text-sm text-fg-muted">
          The endpoint is read-only and exposes team-level retrieval for workspace context, timeline
          events, entities, objects, tasks, boards, calendar, documents, and connected integration
          activity.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="flex-1 break-all rounded-sm border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs">
            {mcpUrl || 'Loading…'}
          </code>
          <Button
            size="sm"
            variant="ghost"
            disabled={!mcpUrl}
            onClick={() => {
              copyToClipboard(mcpUrl);
            }}
          >
            Copy
          </Button>
        </div>
        <p className="text-xs text-fg-dim">
          Timeline currently advertises MCP protocol <code className="font-mono">2024-11-05</code>{' '}
          during <code className="font-mono">initialize</code>. Modern clients that support
          Streamable HTTP compatibility should use this endpoint directly.
        </p>
      </CardContent>
    </Card>
  );
}

function McpRetrievalSummary() {
  return (
    <section className="space-y-3">
      <div className="text-xs text-fg-muted">Available retrieval</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Workspace context', 'retrieve_workspace_context for broad cross-surface questions.'],
          ['Objects and tasks', 'get/search/list objects, active tasks, and board state.'],
          ['Calendar and time', 'list/get events and resolve workspace-relative dates.'],
          ['Docs and integrations', 'semantic and structured document plus integration search.'],
        ].map(([title, description]) => (
          <div key={title} className="rounded-sm border border-border bg-surface p-3">
            <div className="text-sm font-medium text-fg">{title}</div>
            <p className="mt-1 text-xs leading-5 text-fg-muted">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function McpClientGuides({ mcpUrl, mintedKey }: { mcpUrl: string; mintedKey: MintedKey | null }) {
  const codexSnippet = mintedKey
    ? codexCommand(mcpUrl, mintedKey)
    : [
        'export TIMELINE_MCP_KEY="<create a key first>"',
        `codex mcp add timeline --url "${mcpUrl}" --bearer-token-env-var TIMELINE_MCP_KEY`,
      ].join('\n');
  const jsonSnippet = mintedKey
    ? remoteJsonConfig(mcpUrl, mintedKey)
    : JSON.stringify(
        {
          mcpServers: {
            timeline: {
              type: 'streamable-http',
              url: mcpUrl,
              headers: { Authorization: 'Bearer <create a key first>' },
            },
          },
        },
        null,
        2,
      );

  return (
    <section className="space-y-3">
      <div className="text-xs text-fg-muted">Connect from clients</div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Codex CLI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">
              Codex supports Streamable HTTP MCP servers through <code>codex mcp add --url</code>.
              Store the key in an environment variable so it is not written directly into shell
              history.
            </p>
            <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-5">
                <code>{codexSnippet}</code>
              </pre>
            </div>
            {mintedKey ? (
              <CopyButton value={codexSnippet} label="Copy command" />
            ) : (
              <p className="text-xs leading-5 text-fg-dim">
                Create a new key to generate a copy-ready command with the real bearer token.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Claude Desktop, Cursor, and URL clients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">
              Clients with remote MCP JSON config usually need a transport type, URL, and
              Authorization header. If your client only supports local command servers, use its
              remote-MCP bridge and point the bridge at this same URL.
            </p>
            <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-5">
                <code>{jsonSnippet}</code>
              </pre>
            </div>
            {mintedKey ? (
              <CopyButton value={jsonSnippet} label="Copy JSON" />
            ) : (
              <p className="text-xs leading-5 text-fg-dim">
                Create a new key to generate copy-ready JSON with the real Authorization header.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">ChatGPT</CardTitle>
              <Badge variant="outline" className="rounded-sm ">
                Needs OAuth
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">
              ChatGPT can create apps from remote MCP servers in Developer mode. Use this endpoint
              as the connector URL, but note that ChatGPT&apos;s app flow expects OAuth, no-auth, or
              mixed auth; Timeline&apos;s current outbound endpoint uses static bearer keys.
            </p>
            <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-5">
                <code>{chatGptConnectorDetails(mcpUrl)}</code>
              </pre>
            </div>
            <p className="text-xs leading-5 text-fg-dim">
              Treat this as the rollout path, not a guaranteed one-click setup, until Timeline adds
              an OAuth-backed ChatGPT connector or bridge.
            </p>
            <CopyButton value={chatGptConnectorDetails(mcpUrl)} label="Copy details" />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export function McpShareUi({ keys, mcpUrl: initialMcpUrl }: { keys: KeyRow[]; mcpUrl: string }) {
  const router = useRouter();
  const dialog = useAppDialog();
  const keyNameId = useId();
  const busyKeyIds = useRef<Set<string> | null>(null);
  const [keyMutations, setKeyMutations] = useState<
    Record<string, { busy: boolean; error: string | null }>
  >({});

  function activeBusyKeyIds(): Set<string> {
    busyKeyIds.current ??= new Set();
    return busyKeyIds.current;
  }
  const [{ showCreate, name, busy, mintedKey, mcpUrl }, patchState] = useReducer(
    patchMcpShareState,
    {
      showCreate: false,
      name: '',
      busy: false,
      mintedKey: null,
      mcpUrl: initialMcpUrl,
    },
  );

  useEffect(() => {
    if (initialMcpUrl) return;
    patchState({ mcpUrl: `${window.location.origin}/api/mcp/server` });
  }, [initialMcpUrl]);

  async function create() {
    patchState({ busy: true });
    try {
      const res = await fetch('/api/team/mcp-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        await dialog.alert({ title: 'Create failed', description: await res.text() });
        return;
      }
      const data = (await res.json()) as { name: string; plaintext: string };
      patchState({
        mintedKey: { name: data.name, plaintext: data.plaintext },
        name: '',
        showCreate: false,
      });
      router.refresh();
    } finally {
      patchState({ busy: false });
    }
  }

  async function revoke(id: string, label: string) {
    if (activeBusyKeyIds().has(id)) return;
    const confirmed = await dialog.confirm({
      title: 'Revoke key?',
      description: `"${label}" will stop working for any agent using it.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!confirmed) return;
    if (activeBusyKeyIds().has(id)) return;
    activeBusyKeyIds().add(id);
    setKeyMutations((current) => ({ ...current, [id]: { busy: true, error: null } }));
    try {
      const response = await fetch(`/api/team/mcp-keys/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const error = await readPublicApiError(
          response,
          'The key could not be revoked. Try again.',
        );
        setKeyMutations((current) => ({ ...current, [id]: { busy: false, error } }));
        return;
      }
      router.refresh();
    } catch {
      setKeyMutations((current) => ({
        ...current,
        [id]: { busy: false, error: networkActionError('revoke this key') },
      }));
    } finally {
      activeBusyKeyIds().delete(id);
      setKeyMutations((current) => ({
        ...current,
        [id]: { busy: false, error: current[id]?.error ?? null },
      }));
    }
  }

  return (
    <div className="space-y-6">
      <McpStatusGrid />
      <McpEndpointCard mcpUrl={mcpUrl} />
      <McpRetrievalSummary />
      <McpClientGuides mcpUrl={mcpUrl} mintedKey={mintedKey} />

      {mintedKey ? (
        <Card className="border-signal/40">
          <CardHeader>
            <CardTitle className="text-sm">
              New key: copy now, you won&apos;t see it again
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">
              The plaintext for <span className="font-mono">{mintedKey.name}</span> is shown below
              once. We store only the hash; if you lose it you&apos;ll need to mint a new one.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-sm border border-signal/40 bg-surface-2 px-2 py-1.5 font-mono text-xs">
                {mintedKey.plaintext}
              </code>
              <Button
                size="sm"
                onClick={() => {
                  copyToClipboard(mintedKey.plaintext);
                }}
              >
                Copy
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                patchState({ mintedKey: null });
              }}
            >
              I&apos;ve copied it, dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="text-xs text-fg-muted">Active keys ({keys.length})</div>
        <Button
          size="sm"
          onClick={() => {
            patchState({ showCreate: !showCreate });
          }}
        >
          {showCreate ? 'Cancel' : 'New key'}
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="space-y-1">
              <Label htmlFor={keyNameId}>Label</Label>
              <Input
                id={keyNameId}
                name="mcp-key-label"
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  patchState({ name: e.target.value });
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
          {keys.map((k) => {
            const mutation = keyMutations[k.id] ?? { busy: false, error: null };
            return (
              <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{k.name}</div>
                  <div className="font-mono text-xs text-fg-muted">
                    {k.prefix}… · created {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt
                      ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                      : ' · never used'}
                  </div>
                  {mutation.error ? (
                    <p className="mt-1 text-xs text-destructive" role="alert">
                      {mutation.error}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutation.busy}
                  onClick={() => {
                    void revoke(k.id, k.name);
                  }}
                >
                  {mutation.busy ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {dialog.node}
    </div>
  );
}
