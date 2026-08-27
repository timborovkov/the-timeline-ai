'use client';

import { ExternalLink, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useReducer, useRef, useState, type SyntheticEvent } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';
import { CopyButton } from '@/components/copy-button';
import { EmptyState } from '@/components/empty-state';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { SectionHeading } from '@/components/section-heading';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { Label } from '@/components/ui/label';
import { networkActionError, readPublicApiError } from '@/lib/client-api-error';
import { notifyAction } from '@/lib/notify';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
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

function oauthCommand(mcpUrl: string): string {
  return `codex mcp add timeline --url "${mcpUrl}"`;
}

function chatGptConnectorDetails(mcpUrl: string): string {
  return [
    'Settings -> Apps -> Advanced Settings -> Developer Mode',
    'Create a development app',
    'App name: Timeline',
    `MCP server URL: ${mcpUrl}`,
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
  nameError: string | null;
  allowAgent: boolean;
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
        ['Transport', 'Streamable HTTP', 'The SDK negotiates current and legacy revisions.'],
        ['Default OAuth', 'Member-scoped read', 'Consent follows the member’s current visibility.'],
        ['Agent access', 'Separate consent', 'Owners and admins may approve paid agent turns.'],
        ['Static keys', 'Team-visible only', 'Manual-client keys never inherit private access.'],
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
    <section className="space-y-3 border-y border-border py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>MCP endpoint</SectionHeading>
        <Badge variant="outline" className="rounded-sm">
          Streamable HTTP
        </Badge>
      </div>
      <p className="text-sm text-fg-muted">
        Give an OAuth-capable remote MCP client this URL, then sign in, choose a team, and review
        the requested scopes in Timeline. Static bearer keys from this page remain available for
        manual clients. Pick Streamable HTTP or HTTP URL, not legacy SSE.
      </p>
      <p className="text-sm text-fg-muted">
        Every key exposes team-level retrieval for workspace context, timeline events, entities,
        objects, tasks, boards, calendar, documents, and connected integration activity. You can
        separately allow a key to ask the Timeline agent and create proposals for human review.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 break-all rounded-sm border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs">
          {mcpUrl || 'Loading…'}
        </code>
        {mcpUrl ? <CopyButton value={mcpUrl} /> : null}
      </div>
      <p className="text-xs text-fg-dim">
        The Timeline MCP SDK negotiates the current protocol revision and supported legacy revisions
        during <code className="font-mono">initialize</code>. The endpoint also exposes OAuth
        discovery metadata for compatible clients.
      </p>
    </section>
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
          [
            'Timeline agent',
            'Optional stateless agent turns with citations, team MCP tools, and reviewable proposals.',
          ],
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
  const oauthSnippet = oauthCommand(mcpUrl);
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
    <section className="space-y-3 border-y border-border py-4">
      <div className="text-xs text-fg-muted">Connect from clients</div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-fg">Agent plugins and OAuth</h3>
          <p className="text-sm text-fg-muted">
            The Codex and Claude Code plugins bundle this URL without an Authorization header so the
            client can discover Timeline OAuth. Use the install guide for either plugin. For a
            direct Codex connection, add the URL below, then complete browser sign-in and consent.
          </p>
          <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
            <pre translate="no" className="overflow-x-auto p-3 font-mono text-xs leading-5">
              <code>{oauthSnippet}</code>
            </pre>
          </div>
          <CopyButton value={oauthSnippet} label="Copy OAuth command" />
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Link href="/help/agents" className="text-xs font-medium text-signal hover:underline">
              Copy-ready agent install guide
            </Link>
            <a
              href="https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-codex"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline"
            >
              Install in Codex
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
            <a
              href="https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-claude-code"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline"
            >
              Install in Claude Code
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-fg">Static-key clients</h3>
          <p className="text-sm text-fg-muted">
            Use a key only when a manual client cannot complete the OAuth flow. The generated JSON
            contains the one-time bearer secret in its Authorization header.
          </p>
          <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
            <pre translate="no" className="overflow-x-auto p-3 font-mono text-xs leading-5">
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
          <p className="text-xs leading-5 text-fg-dim">
            Generated JSON contains the bearer key. Store it only in the client&apos;s protected
            local configuration, keep it out of repositories and shared folders, and follow that
            client&apos;s credential-storage guidance.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">ChatGPT</h3>
            <Badge variant="outline" className="rounded-sm">
              OAuth ready
            </Badge>
          </div>
          <p className="text-sm text-fg-muted">
            ChatGPT Developer Mode can create an app from this remote MCP server. Use this endpoint
            as the MCP server URL. ChatGPT discovers Timeline&apos;s OAuth metadata, opens the
            sign-in/team-consent flow, and uses the approved member-scoped grant.
          </p>
          <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
            <pre className="overflow-x-auto p-3 font-mono text-xs leading-5">
              <code>{chatGptConnectorDetails(mcpUrl)}</code>
            </pre>
          </div>
          <p className="text-xs leading-5 text-fg-dim">
            A private Developer Mode app and an OpenAI universal Plugins Directory
            <strong> With MCP</strong> submission use the same remote endpoint. The public draft
            also bundles the Timeline skill and still requires separate provider review and
            publication.
          </p>
          <CopyButton value={chatGptConnectorDetails(mcpUrl)} label="Copy details" />
        </div>
      </div>
    </section>
  );
}

export function McpShareUi({ keys, mcpUrl: initialMcpUrl }: { keys: KeyRow[]; mcpUrl: string }) {
  const router = useRouter();
  const dialog = useAppDialog();
  const keyNameId = useId();
  const keyNameErrorId = useId();
  const keyNameRef = useRef<HTMLInputElement>(null);
  const focusNameOnError = useRef(false);
  const busyKeyIds = useRef<Set<string> | null>(null);
  const [keyMutations, setKeyMutations] = useState<Record<string, { busy: boolean }>>({});

  function activeBusyKeyIds(): Set<string> {
    busyKeyIds.current ??= new Set();
    return busyKeyIds.current;
  }
  const [{ showCreate, name, nameError, allowAgent, busy, mintedKey, mcpUrl }, patchState] =
    useReducer(patchMcpShareState, {
      showCreate: false,
      name: '',
      nameError: null,
      allowAgent: false,
      busy: false,
      mintedKey: null,
      mcpUrl: initialMcpUrl,
    });

  useEffect(() => {
    if (initialMcpUrl) return;
    patchState({ mcpUrl: `${window.location.origin}/api/mcp/server` });
  }, [initialMcpUrl]);

  useEffect(() => {
    if (!nameError || !focusNameOnError.current) return;
    keyNameRef.current?.focus();
    focusNameOnError.current = false;
  }, [nameError]);

  function submitCreate(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      focusNameOnError.current = true;
      patchState({ nameError: 'Enter a label for this key.' });
      return;
    }
    void create();
  }

  async function create() {
    patchState({ busy: true });
    const result = await notifyAction({
      id: 'mcp:create-key',
      loading: 'Creating key…',
      success: 'Key created',
      error: 'Couldn’t create key',
      run: async () => {
        const res = await fetch('/api/team/mcp-keys', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, allowAgent }),
        });
        if (!res.ok) return { error: 'failed' };
        const data = (await res.json()) as { name: string; plaintext: string };
        patchState({
          mintedKey: { name: data.name, plaintext: data.plaintext },
          name: '',
          allowAgent: false,
          showCreate: false,
        });
        return { ok: true };
      },
    });
    patchState({ busy: false });
    if (!result.error) router.refresh();
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
    setKeyMutations((current) => ({ ...current, [id]: { busy: true } }));
    const result = await notifyAction({
      id: `mcp-key:${id}:revoke`,
      loading: 'Revoking key…',
      success: 'Key revoked',
      error: 'Couldn’t revoke key',
      run: async () => {
        try {
          const response = await fetch(`/api/team/mcp-keys/${id}`, { method: 'DELETE' });
          if (!response.ok) {
            return {
              error: await readPublicApiError(response, 'The key could not be revoked. Try again.'),
            };
          }
          return { ok: true };
        } catch {
          return { error: networkActionError('revoke this key') };
        }
      },
    });
    activeBusyKeyIds().delete(id);
    setKeyMutations((current) => ({ ...current, [id]: { busy: false } }));
    if (!result.error) router.refresh();
  }

  return (
    <div className="space-y-6">
      <McpStatusGrid />
      <McpEndpointCard mcpUrl={mcpUrl} />
      <McpRetrievalSummary />
      <McpClientGuides mcpUrl={mcpUrl} mintedKey={mintedKey} />

      {mintedKey ? (
        <div className="space-y-3 border-y border-signal/40 py-4">
          <div>
            <div className="text-sm font-medium">
              New key: keep this open until your client is connected
            </div>
            <p className="text-sm text-fg-muted">
              The plaintext for <span className="font-mono">{mintedKey.name}</span> is shown below
              once. We store only the hash; if you lose it you&apos;ll need to mint a new one.
            </p>
            <p className="mt-2 text-sm text-fg-muted">
              For a static-key client, copy the generated JSON above or store this value in the
              client&apos;s protected credential field. Dismiss it only after that client is
              connected.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-sm border border-signal/40 bg-surface-2 px-2 py-1.5 font-mono text-xs">
              {mintedKey.plaintext}
            </code>
            <CopyButton value={mintedKey.plaintext} />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              patchState({ mintedKey: null });
            }}
          >
            Connected — dismiss key
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="text-xs text-fg-muted">Active keys ({keys.length})</div>
        <Button
          size="sm"
          onClick={() => {
            patchState({ showCreate: !showCreate, nameError: null });
          }}
        >
          {showCreate ? 'Cancel' : 'New key'}
        </Button>
      </div>

      {showCreate ? (
        <form
          className="space-y-3 border-y border-border py-4"
          noValidate
          onSubmit={submitCreate}
          aria-busy={busy}
        >
          <div className="space-y-1">
            <Label htmlFor={keyNameId}>
              Label <span aria-hidden="true">(required)</span>
            </Label>
            <Input
              ref={keyNameRef}
              id={keyNameId}
              name="mcp-key-label"
              autoComplete="off"
              required
              value={name}
              onChange={(e) => {
                patchState({ name: e.target.value, nameError: null });
              }}
              placeholder="Claude Desktop · personal mac"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? keyNameErrorId : undefined}
            />
            {nameError ? (
              <p id={keyNameErrorId} role="alert" className="text-xs text-danger">
                {nameError}
              </p>
            ) : null}
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border bg-surface-2 p-3">
            <input
              type="checkbox"
              name="allow-agent"
              className="mt-0.5 size-4 shrink-0"
              checked={allowAgent}
              onChange={(event) => {
                patchState({ allowAgent: event.currentTarget.checked });
              }}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-fg">Allow Timeline agent</span>
              <span className="block text-xs leading-5 text-fg-muted">
                This key can start paid agent turns, use enabled team MCP tools, and create
                team-visible proposals. A teammate must still approve every proposal.
              </span>
            </span>
          </label>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Create key · creating…' : 'Create key'}
          </Button>
        </form>
      ) : null}

      {keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          size="inset"
          title="No active keys"
          body="Create a retrieval key, with optional access to the Timeline agent."
        />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {keys.map((k) => {
            const mutation = keyMutations[k.id] ?? { busy: false };
            return (
              <li key={k.id}>
                <CollectionRow>
                  <CollectionRow.Title>{k.name}</CollectionRow.Title>
                  <CollectionRow.Context>
                    <span className="inline-flex flex-wrap items-center gap-x-1">
                      <span>{k.prefix}…</span>
                      <RelativeTimestamp prefix="created" value={k.createdAt} />
                      {k.lastUsedAt ? (
                        <RelativeTimestamp prefix="last used" value={k.lastUsedAt} />
                      ) : (
                        <span>never used</span>
                      )}
                    </span>
                  </CollectionRow.Context>
                  <CollectionRow.Metadata>
                    <Badge variant="outline" className="rounded-sm">
                      Retrieval
                    </Badge>
                    {k.scopes.includes('agent:ask') ? (
                      <Badge variant="outline" className="rounded-sm">
                        Timeline agent
                      </Badge>
                    ) : null}
                  </CollectionRow.Metadata>
                  <CollectionRow.Actions>
                    <ItemActionGroup label={`Actions for ${k.name}`}>
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
                    </ItemActionGroup>
                  </CollectionRow.Actions>
                </CollectionRow>
              </li>
            );
          })}
        </ul>
      )}
      {dialog.node}
    </div>
  );
}
