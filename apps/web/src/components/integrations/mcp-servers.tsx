'use client';

import { useRouter } from 'next/navigation';
import { useId, useReducer, useRef, useState, type SyntheticEvent } from 'react';

import { TechnicalDetails } from '@/components/technical-details';
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

function authTypeLabel(authType: string): string {
  const labels: Record<string, string> = {
    none: 'No authentication',
    bearer: 'Bearer token',
    header: 'Custom header',
    basic: 'Basic authentication',
    url_key: 'URL key',
    oauth: 'OAuth',
  };
  return labels[authType] ?? authType;
}

async function startOAuth(server: McpServerRow, dialog: AppDialogApi): Promise<void> {
  try {
    const res = await fetch('/api/mcp/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mcpServerId: server.id }),
    });
    if (!res.ok) {
      await dialog.alert({
        title: 'Unable to start authorization',
        description: 'Authorization could not start. Check your connection and try again.',
      });
      return;
    }
    const data = (await res.json()) as { url?: string };
    if (data.url) window.location.href = data.url;
    else {
      await dialog.alert({
        title: 'Unable to start authorization',
        description: 'Authorization could not start. Check your connection and try again.',
      });
    }
  } catch {
    await dialog.alert({
      title: 'Unable to start authorization',
      description: 'Authorization could not start. Check your connection and try again.',
    });
  }
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
  const formRef = useRef<HTMLFormElement>(null);
  const [{ name, url, authType, token, headerName, headerValue, busy }, setFormState] = useReducer(
    patchAddServerState,
    INITIAL_ADD_SERVER_STATE,
  );

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current?.reportValidity()) return;
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
        await dialog.alert({
          title: 'Unable to add server',
          description: await readPublicApiError(
            res,
            'The server could not be added. Check its settings and try again.',
          ),
        });
        return;
      }
      // Start authorization immediately so a new OAuth server is not left disabled.
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        needsOauth?: boolean;
      };
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
            return;
          }
        } catch {
          // The server was created, so OAuth failure is recoverable from its Connect action.
        }

        await dialog.alert({
          title: 'Unable to start authorization',
          description:
            'The server was added, but authorization must be retried. Connect it again to retry.',
        });
        router.refresh();
        if (onDone) onDone();
        return;
      }
      router.refresh();
      if (onDone) onDone();
    } catch {
      await dialog.alert({
        title: 'Unable to add server',
        description: networkActionError('add this server'),
      });
    } finally {
      setFormState({ busy: false });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3" className="text-sm">
          Add MCP server
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form ref={formRef} className="space-y-3" onSubmit={(event) => void submit(event)}>
          {ownership === 'personal' ? (
            <p className="text-sm text-fg-muted">
              Only you can use this server&apos;s tools in chats you start.
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-name`}>Server name</Label>
              <Input
                id={`${formId}-name`}
                name="mcp-server-name"
                autoComplete="off"
                autoFocus
                required
                value={name}
                onChange={(e) => {
                  setFormState({ name: e.target.value });
                }}
                placeholder="Context7"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-url`}>Server URL</Label>
              <Input
                id={`${formId}-url`}
                name="mcp-server-url"
                type="url"
                autoComplete="off"
                inputMode="url"
                required
                spellCheck={false}
                value={url}
                onChange={(e) => {
                  setFormState({ url: e.target.value });
                }}
                placeholder="https://mcp.example.com/mcp"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-auth-type`}>Authentication</Label>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy} aria-busy={busy}>
              {busy ? 'Adding server…' : 'Add server'}
            </Button>
            {onCancel ? (
              <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
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
  const addFormId = useId();
  const addServerTrigger = useRef<HTMLButtonElement>(null);
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

  const isPersonalServer = ownership === 'personal';
  const addServerLabel = isPersonalServer ? 'Add personal server' : 'Add server';

  function closeAddServerForm() {
    setShowAdd(false);
    addServerTrigger.current?.focus();
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
    const isPersonalServer = ownership === 'personal';
    const confirmed = await dialog.confirm({
      title: `Remove ${isPersonalServer ? 'personal' : 'team'} MCP server?`,
      description: isPersonalServer
        ? `${server.name} will be removed from your personal MCP servers. Only you will lose access to its tools.`
        : `${server.name} will be removed from this team. Everyone on this team will lose access to its tools.`,
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
    <div className="space-y-4">
      {hideAddButton ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            ref={addServerTrigger}
            size="sm"
            aria-controls={addFormId}
            aria-expanded={showAdd}
            onClick={() => {
              setShowAdd((s) => !s);
            }}
          >
            {showAdd ? 'Cancel' : addServerLabel}
          </Button>
        </div>
      )}

      {!hideAddButton && showAdd ? (
        <div id={addFormId}>
          <AddCustomMcpServerForm
            ownership={ownership ?? 'team'}
            onDone={() => {
              setShowAdd(false);
            }}
            onCancel={closeAddServerForm}
          />
        </div>
      ) : null}

      {servers.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium text-fg">
            {isPersonalServer ? 'No personal MCP servers' : 'No custom MCP servers'}
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            {isPersonalServer
              ? 'Add a custom server to use its tools in chats you start. Teammates cannot view or use it.'
              : 'Add a custom server to make its tools available to this team.'}
          </p>
        </div>
      ) : (
        <ul
          aria-label={isPersonalServer ? 'Personal MCP servers' : 'MCP servers'}
          className="divide-y divide-border rounded-lg border border-border bg-surface"
        >
          {servers.map((s) => {
            const mutation = rowMutations[s.id] ?? { busy: null, error: null };
            return (
              <li key={s.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-sm font-medium text-fg">{s.name}</h3>
                      <span className="text-xs text-fg-muted">{authTypeLabel(s.authType)}</span>
                      {!s.enabled ? (
                        <span className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-fg-muted">
                          Disabled
                        </span>
                      ) : null}
                    </div>
                    <p className="break-all text-xs text-fg-muted">{s.url}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
                {s.lastError ? (
                  <div className="space-y-2">
                    <p className="text-xs text-destructive">
                      This server needs attention. Reconnect it or test the connection again.
                    </p>
                    <TechnicalDetails
                      items={[
                        {
                          label: 'Connection error',
                          value: s.lastError,
                          copyValue: s.lastError,
                        },
                      ]}
                    />
                  </div>
                ) : null}
                {mutation.error ? (
                  <p className="text-xs text-destructive" role="alert">
                    {mutation.error}
                  </p>
                ) : null}
                {s.cachedTools.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-fg-muted">
                      Available tools ({s.cachedTools.length})
                    </h4>
                    <ul className="space-y-2">
                      {s.cachedTools.map((t) => (
                        <li
                          key={t.name}
                          className="flex flex-col gap-2 text-xs sm:flex-row sm:items-start sm:justify-between"
                        >
                          <div className="min-w-0">
                            <span className="font-mono">{t.name}</span>
                            {t.description ? (
                              <span className="text-fg-muted">: {t.description}</span>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="self-start"
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
                  <p className="text-xs text-fg-muted">No tools are available yet.</p>
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
