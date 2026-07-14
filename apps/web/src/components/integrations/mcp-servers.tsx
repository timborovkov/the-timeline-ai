'use client';

import { useRouter } from 'next/navigation';
import { useId, useReducer, useRef, useState } from 'react';

import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { networkActionError, readPublicApiError } from '@/lib/client-api-error';

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
  const formId = useId();
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
      // Start authorization immediately so a new OAuth server is not left disabled.
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
            <Label htmlFor={`${formId}-name`}>Display name</Label>
            <Input
              id={`${formId}-name`}
              name="mcp-server-name"
              autoComplete="off"
              value={name}
              onChange={(e) => {
                setFormState({ name: e.target.value });
              }}
              placeholder="Context7"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-url`}>URL</Label>
            <Input
              id={`${formId}-url`}
              name="mcp-server-url"
              type="url"
              autoComplete="off"
              value={url}
              onChange={(e) => {
                setFormState({ url: e.target.value });
              }}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-auth-type`}>Auth type</Label>
            <select
              id={`${formId}-auth-type`}
              name="mcp-auth-type"
              className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={authType}
              onChange={(e) => {
                setFormState({ authType: e.target.value as AuthType });
              }}
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="header">Custom header</option>
              <option value="oauth">OAuth</option>
            </select>
          </div>
          {authType === 'bearer' ? (
            <div className="space-y-1">
              <Label htmlFor={`${formId}-token`}>Token</Label>
              <Input
                id={`${formId}-token`}
                name="mcp-bearer-token"
                autoComplete="off"
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
                <Label htmlFor={`${formId}-header-name`}>Header name</Label>
                <Input
                  id={`${formId}-header-name`}
                  name="mcp-header-name"
                  autoComplete="off"
                  value={headerName}
                  onChange={(e) => {
                    setFormState({ headerName: e.target.value });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${formId}-header-value`}>Header value</Label>
                <Input
                  id={`${formId}-header-value`}
                  name="mcp-header-value"
                  autoComplete="off"
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
  const [rowMutations, setRowMutations] = useState<
    Record<string, { busy: 'toggle' | 'remove' | null; error: string | null }>
  >({});
  const busyIds = useRef<Set<string> | null>(null);

  function activeBusyIds(): Set<string> {
    busyIds.current ??= new Set();
    return busyIds.current;
  }

  function setRowMutation(
    id: string,
    patch: Partial<{ busy: 'toggle' | 'remove' | null; error: string | null }>,
  ) {
    setRowMutations((current) => ({
      ...current,
      [id]: { busy: null, error: null, ...current[id], ...patch },
    }));
  }

  async function toggleEnabled(server: McpServerRow) {
    if (activeBusyIds().has(server.id)) return;
    activeBusyIds().add(server.id);
    setRowMutation(server.id, { busy: 'toggle', error: null });
    try {
      const response = await fetch(`/api/team/mcp-servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      if (!response.ok) {
        setRowMutation(server.id, {
          error: await readPublicApiError(response, 'The server could not be updated. Try again.'),
        });
        return;
      }
      router.refresh();
    } catch {
      setRowMutation(server.id, {
        error: networkActionError(server.enabled ? 'disable this server' : 'enable this server'),
      });
    } finally {
      activeBusyIds().delete(server.id);
      setRowMutation(server.id, { busy: null });
    }
  }

  async function remove(server: McpServerRow) {
    if (activeBusyIds().has(server.id)) return;
    const confirmed = await dialog.confirm({
      title: 'Remove MCP server?',
      description: `${server.name} will be disconnected from this team.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;
    if (activeBusyIds().has(server.id)) return;
    activeBusyIds().add(server.id);
    setRowMutation(server.id, { busy: 'remove', error: null });
    try {
      const response = await fetch(`/api/team/mcp-servers/${server.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setRowMutation(server.id, {
          error: await readPublicApiError(response, 'The server could not be removed. Try again.'),
        });
        return;
      }
      router.refresh();
    } catch {
      setRowMutation(server.id, { error: networkActionError('remove this server') });
    } finally {
      activeBusyIds().delete(server.id);
      setRowMutation(server.id, { busy: null });
    }
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
          {servers.map((s) => {
            const mutation = rowMutations[s.id] ?? { busy: null, error: null };
            return (
              <li key={s.id} className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="text-xs text-fg-muted">{s.authType}</span>
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
                      disabled={mutation.busy !== null}
                      onClick={() => {
                        void toggleEnabled(s);
                      }}
                    >
                      {mutation.busy === 'toggle'
                        ? s.enabled
                          ? 'Disabling…'
                          : 'Enabling…'
                        : s.enabled
                          ? 'Disable'
                          : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={mutation.busy !== null}
                      onClick={() => {
                        void remove(s);
                      }}
                    >
                      {mutation.busy === 'remove' ? 'Removing…' : 'Remove'}
                    </Button>
                  </div>
                </div>
                <div className="break-all text-xs text-fg-muted">{s.url}</div>
                {s.lastError ? (
                  <div className="text-xs text-destructive">Error: {s.lastError}</div>
                ) : null}
                {mutation.error ? (
                  <p className="text-xs text-destructive" role="alert">
                    {mutation.error}
                  </p>
                ) : null}
                {s.cachedTools.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-xs text-fg-muted">Tools ({s.cachedTools.length})</div>
                    <ul className="space-y-1">
                      {s.cachedTools.map((t) => (
                        <li
                          key={t.name}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
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
            );
          })}
        </ul>
      )}
      {dialog.node}
    </div>
  );
}
