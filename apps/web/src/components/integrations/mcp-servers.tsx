'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useState } from 'react';

import { useAppDialog } from '@/components/ui/app-dialog';
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

interface AddServerState {
  name: string;
  url: string;
  authType: AuthType;
  token: string;
  headerName: string;
  headerValue: string;
  busy: boolean;
}

const INITIAL_ADD_SERVER_STATE: AddServerState = {
  name: '',
  url: '',
  authType: 'none',
  token: '',
  headerName: '',
  headerValue: '',
  busy: false,
};

function patchAddServerState(
  state: AddServerState,
  patch: Partial<AddServerState>,
): AddServerState {
  return { ...state, ...patch };
}

type AppDialogApi = ReturnType<typeof useAppDialog>;

async function startOAuth(server: McpServerRow, dialog: AppDialogApi): Promise<void> {
  const res = await fetch('/api/mcp/oauth/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mcpServerId: server.id }),
  });
  if (!res.ok) {
    await dialog.alert({ title: 'OAuth start failed', description: await res.text() });
    return;
  }
  const data = (await res.json()) as { url?: string; error?: string };
  if (data.url) window.location.href = data.url;
  else await dialog.alert({ title: 'OAuth start failed', description: data.error ?? 'unknown' });
}

async function testCall(
  server: McpServerRow,
  toolName: string,
  dialog: AppDialogApi,
): Promise<void> {
  const namespaced = `mcp__${server.id.replace(/-/g, '')}__${toolName}`;
  const argsRaw = await dialog.input({
    title: 'Test tool call',
    description: `Args (JSON) for ${toolName}`,
    inputLabel: 'Arguments',
    defaultValue: '{}',
    confirmLabel: 'Run test',
  });
  if (argsRaw === null) return;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsRaw) as Record<string, unknown>;
  } catch {
    await dialog.alert({ title: 'Invalid JSON', description: 'Enter a valid JSON object.' });
    return;
  }
  const res = await fetch(`/api/team/mcp-servers/${server.id}/tools`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: namespaced, args }),
  });
  const text = await res.text();
  const parsed = parseToolResponse(text);
  if (parsed?.error === 'needs_reauth') {
    const serverName =
      typeof parsed.mcp_server_name === 'string' && parsed.mcp_server_name.trim()
        ? parsed.mcp_server_name
        : server.name;
    await dialog.alert({
      title: 'Reconnect required',
      description: `${serverName} needs to be reconnected before this tool can run.`,
    });
    return;
  }
  if (!res.ok || parsed?.ok === false) {
    const error = typeof parsed?.error === 'string' && parsed.error.trim() ? parsed.error : text;
    await dialog.alert({
      title: 'Tool call failed',
      description: error,
    });
    return;
  }
  await dialog.alert({ title: 'Tool response', description: text });
}

function parseToolResponse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Standalone add-server form. Mounted by either:
 *   - <McpServersUi> on the personal MCP page (toggle button just above
 *     the connected list), or
 *   - the team /integrations page action bar (the "+ Add custom MCP
 *     server" affordance — see <AddCustomMcpServerLauncher>).
 */
function AddCustomMcpServerForm({
  ownership,
  onDone,
  onCancel,
}: {
  ownership: 'team' | 'personal';
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [{ name, url, authType, token, headerName, headerValue, busy }, setFormState] = useReducer(
    patchAddServerState,
    INITIAL_ADD_SERVER_STATE,
  );

  async function submit() {
    setFormState({ busy: true });
    try {
      const body: Record<string, unknown> = { name, url, authType };
      if (ownership === 'personal') body.ownership = 'personal';
      if (authType === 'bearer') body.authConfig = { token };
      else if (authType === 'header') body.authConfig = { name: headerName, value: headerValue };
      const res = await fetch('/api/team/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        await dialog.alert({ title: 'Add failed', description: text });
        return;
      }
      // If the server was created as OAuth, immediately bounce into the
      // authorize roundtrip — otherwise the row sits disabled until the
      // user finds the Connect button in the connected list. Mirrors
      // the catalog connect flow.
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        needsOauth?: boolean;
      };
      if (data.needsOauth && data.id) {
        const oauth = await fetch('/api/mcp/oauth/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mcpServerId: data.id }),
        });
        if (!oauth.ok) {
          await dialog.alert({ title: 'OAuth start failed', description: await oauth.text() });
          router.refresh();
          if (onDone) onDone();
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
      if (onDone) onDone();
    } finally {
      setFormState({ busy: false });
    }
  }

  return (
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
                setFormState({ name: e.target.value });
              }}
              placeholder="Context7"
            />
          </div>
          <div className="space-y-1">
            <Label>URL</Label>
            <Input
              value={url}
              onChange={(e) => {
                setFormState({ url: e.target.value });
              }}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
          <div className="space-y-1">
            <Label>Auth type</Label>
            <select
              className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-sm"
              value={authType}
              onChange={(e) => {
                setFormState({ authType: e.target.value as AuthType });
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
                  setFormState({ token: e.target.value });
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
                    setFormState({ headerName: e.target.value });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Header value</Label>
                <Input
                  type="password"
                  value={headerValue}
                  onChange={(e) => {
                    setFormState({ headerValue: e.target.value });
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy || !name || !url} onClick={() => void submit()}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
          {onCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
        {dialog.node}
      </CardContent>
    </Card>
  );
}

/**
 * Self-contained "+ Add custom MCP server" button + collapsible form.
 * Used in the integrations action bar on /app/team/integrations.
 */
export function AddCustomMcpServerLauncher({ ownership }: { ownership: 'team' | 'personal' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant={open ? 'ghost' : 'default'}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? 'Cancel' : '+ Add custom MCP server'}
      </Button>
      {open ? (
        <div className="col-span-full mt-2 w-full">
          <AddCustomMcpServerForm
            ownership={ownership}
            onDone={() => {
              setOpen(false);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

export function McpServersUi({
  servers,
  ownership,
  hideAddButton,
}: {
  servers: McpServerRow[];
  ownership?: 'team' | 'personal';
  hideAddButton?: boolean;
}) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [showAdd, setShowAdd] = useState(false);

  async function toggleEnabled(server: McpServerRow) {
    await fetch(`/api/team/mcp-servers/${server.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    router.refresh();
  }

  async function remove(server: McpServerRow) {
    const confirmed = await dialog.confirm({
      title: 'Remove MCP server?',
      description: `${server.name} will be disconnected from this team.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;
    await fetch(`/api/team/mcp-servers/${server.id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {hideAddButton ? null : (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={() => {
              setShowAdd((s) => !s);
            }}
          >
            {showAdd ? 'Cancel' : '+ Add server'}
          </Button>
        </div>
      )}

      {!hideAddButton && showAdd ? (
        <AddCustomMcpServerForm
          ownership={ownership ?? 'team'}
          onDone={() => {
            setShowAdd(false);
          }}
          onCancel={() => {
            setShowAdd(false);
          }}
        />
      ) : null}

      {servers.length === 0 ? (
        <p className="text-sm text-fg-muted">No custom MCP servers connected.</p>
      ) : (
        <ul className="divide-y divide-border rounded-sm border border-border bg-surface">
          {servers.map((s) => (
            <li key={s.id} className="space-y-2 p-3">
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
                        void startOAuth(s, dialog);
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
                            <span className="ml-2 text-fg-muted">: {t.description}</span>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void testCall(s, t.name, dialog);
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
      {dialog.node}
    </div>
  );
}
