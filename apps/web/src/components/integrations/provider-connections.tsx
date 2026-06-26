'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState } from 'react';

import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { groupResourcesByKind, providerLabel, shareDisplayName } from '@/lib/resource-labels';
import { connectionErrorMessage } from '@/lib/ux-errors';

interface ProviderResource {
  kind: string;
  externalId: string;
  label: string;
  searchText?: string;
}

interface ResourceShare {
  id: string;
  providerConnectionId: string;
  resourceKind: string;
  externalId: string;
  externalLabel: string | null;
  revokedAt: string | null;
}

interface ProviderConnection {
  id: string;
  provider: string;
  displayName: string;
  lastError: string | null;
  lastConnectedAt: string;
}

interface ConnectionResourcesPayload {
  resources?: ProviderResource[];
  shares?: ResourceShare[];
  error?: string;
}

type SourcePickerAction =
  | { type: 'query'; query: string }
  | { type: 'toggle'; key: string; currentSelected: Set<string> }
  | { type: 'busy'; busy: 'save' | 'delete' | 'reconnect' | null }
  | { type: 'error'; error: string | null }
  | { type: 'confirmDelete' }
  | { type: 'resetSelection' };

interface SourcePickerState {
  selectedOverride: Set<string> | null;
  query: string;
  busy: 'save' | 'delete' | 'reconnect' | null;
  error: string | null;
  confirmDelete: boolean;
}

const initialSourcePickerState: SourcePickerState = {
  selectedOverride: null,
  query: '',
  busy: null,
  error: null,
  confirmDelete: false,
};

const emptyResources: ProviderResource[] = [];
const emptyShares: ResourceShare[] = [];

async function readJsonResponse<T extends { error?: string }>(res: Response): Promise<T> {
  const text = await res.text();
  let data = {} as T;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      if (!res.ok) throw new Error(text);
      throw new Error(connectionErrorMessage('request_failed'));
    }
  }
  if (!res.ok) throw new Error(data.error ?? (text || connectionErrorMessage('request_failed')));
  return data;
}

const providerSourceHints: Partial<
  Record<
    string,
    {
      body: string;
      detail?: string;
      link?: { href: string; label: string };
    }
  >
> = {
  github: {
    body: 'Choose individual repositories for a fixed list, or choose a GitHub organization to include all repos your GitHub account can access there.',
    detail:
      'Missing an organization? GitHub may require org owner approval or SAML authorization before it appears here.',
    link: { href: 'https://github.com/settings/applications', label: 'GitHub access' },
  },
  monday: {
    body: 'Choose Monday.com boards to capture items, updates, columns, and subitems together. Classic “Subitems of …” helper boards stay hidden because the parent board already imports them. Choose WorkDocs when docs should become cited timeline evidence too.',
  },
  slack: {
    body: 'Choose the Slack channels whose messages, threads, files, reactions, and edits should become cited timeline events.',
  },
  sentry: {
    body: 'Choose individual Sentry projects for a fixed list, or choose an organization to include all projects your Sentry account can access there.',
  },
};

function resourceKey(resource: Pick<ProviderResource, 'kind' | 'externalId'>) {
  return `${resource.kind}\x00${resource.externalId}`;
}

function shareKey(share: Pick<ResourceShare, 'resourceKind' | 'externalId'>) {
  return `${share.resourceKind}\x00${share.externalId}`;
}

function sourcePickerReducer(
  state: SourcePickerState,
  action: SourcePickerAction,
): SourcePickerState {
  switch (action.type) {
    case 'query':
      return { ...state, query: action.query };
    case 'toggle': {
      const next = new Set(action.currentSelected);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return { ...state, selectedOverride: next };
    }
    case 'busy':
      return { ...state, busy: action.busy };
    case 'error':
      return { ...state, error: action.error };
    case 'confirmDelete':
      return { ...state, confirmDelete: !state.confirmDelete };
    case 'resetSelection':
      return { ...state, selectedOverride: null };
  }
}

export function PersonalConnectionsUi({ connections }: { connections: ProviderConnection[] }) {
  if (connections.length === 0) {
    return (
      <div className="space-y-3">
        <PersonalConnectionFlow />
        <div className="rounded-sm border border-dashed border-border bg-surface p-4 text-sm text-fg-muted">
          No provider connections yet.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <PersonalConnectionFlow />
      {connections.map((connection) => (
        <ConnectionSources key={connection.id} connection={connection} />
      ))}
    </div>
  );
}

function PersonalConnectionFlow() {
  return (
    <div className="grid gap-2 rounded-sm border border-border bg-surface-2 p-3 text-sm md:grid-cols-3">
      <div>
        <p className="font-medium text-fg">1. Connect personally</p>
        <p className="mt-1 text-fg-muted">Timeline uses your provider account to see sources.</p>
      </div>
      <div>
        <p className="font-medium text-fg">2. Share to this team</p>
        <p className="mt-1 text-fg-muted">Select only the sources this team may use.</p>
      </div>
      <div>
        <p className="font-medium text-fg">3. Activate sync</p>
        <p className="mt-1 text-fg-muted">
          A team admin enables the shared sources on Team integrations.
        </p>
      </div>
    </div>
  );
}

function ConnectionSources({ connection }: { connection: ProviderConnection }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(sourcePickerReducer, initialSourcePickerState);
  const {
    data,
    error: queryError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.providerConnectionResources(connection.id),
    queryFn: async () => {
      const res = await fetch(`/api/connections/${connection.id}/resources`);
      return readJsonResponse<ConnectionResourcesPayload>(res);
    },
  });

  const resources = data?.resources ?? emptyResources;
  const shares = data?.shares ?? emptyShares;
  const savedSelected = useMemo(() => {
    const next = new Set<string>();
    for (const share of shares) {
      if (!share.revokedAt) next.add(shareKey(share));
    }
    return next;
  }, [shares]);
  const selected = state.selectedOverride ?? savedSelected;
  const error = state.error ?? (queryError instanceof Error ? queryError.message : null);
  const query = state.query;

  const resourceByKey = useMemo(() => {
    return new Map(resources.map((resource) => [resourceKey(resource), resource]));
  }, [resources]);
  const activeShareByKey = useMemo(() => {
    const next = new Map<string, ResourceShare>();
    for (const share of shares) {
      if (!share.revokedAt) next.set(shareKey(share), share);
    }
    return next;
  }, [shares]);
  const selectableResources = useMemo(() => {
    const hiddenSelectedResources: ProviderResource[] = [];
    for (const key of selected) {
      if (resourceByKey.has(key)) continue;
      const resource = activeShareToResource(activeShareByKey.get(key));
      if (resource) hiddenSelectedResources.push(resource);
    }
    return [...resources, ...hiddenSelectedResources];
  }, [activeShareByKey, resourceByKey, resources, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return selectableResources;
    return selectableResources.filter(
      (resource) =>
        resource.label.toLowerCase().includes(q) ||
        resource.externalId.toLowerCase().includes(q) ||
        (resource.searchText?.toLowerCase().includes(q) ?? false) ||
        resourceKindSearchText(resource.kind).includes(q),
    );
  }, [query, selectableResources]);

  const grouped = useMemo(() => groupResourcesByKind(filtered), [filtered]);

  function toggle(resource: ProviderResource) {
    dispatch({ type: 'toggle', key: resourceKey(resource), currentSelected: selected });
  }

  async function save() {
    dispatch({ type: 'busy', busy: 'save' });
    dispatch({ type: 'error', error: null });
    const chosen = [...selected]
      .map((key) => resourceByKey.get(key) ?? activeShareToResource(activeShareByKey.get(key)))
      .filter((resource): resource is ProviderResource => Boolean(resource));
    try {
      const res = await fetch(`/api/connections/${connection.id}/resources`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resources: chosen.map((resource) => ({
            kind: resource.kind,
            externalId: resource.externalId,
            label: resource.label,
          })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refetch();
      dispatch({ type: 'resetSelection' });
      router.refresh();
    } catch (err) {
      dispatch({ type: 'error', error: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      dispatch({ type: 'busy', busy: null });
    }
  }

  async function deleteConnection() {
    dispatch({ type: 'busy', busy: 'delete' });
    dispatch({ type: 'error', error: null });
    try {
      const res = await fetch(`/api/connections/${connection.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err) {
      dispatch({ type: 'error', error: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      dispatch({ type: 'busy', busy: null });
    }
  }

  async function reconnect() {
    dispatch({ type: 'busy', busy: 'reconnect' });
    dispatch({ type: 'error', error: null });
    try {
      const res = await fetch(`/api/integrations/${connection.provider}/start`, {
        method: 'POST',
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? connectionErrorMessage(data.error, res.status));
      }
      window.location.href = data.url;
    } catch (err) {
      dispatch({
        type: 'error',
        error: err instanceof Error ? err.message : 'Reconnect failed',
      });
      dispatch({ type: 'busy', busy: null });
    }
  }

  return (
    <section className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{providerLabel(connection.provider)}</span>
        <span className="text-sm text-fg-muted">{connection.displayName}</span>
        {connection.lastError ? (
          <>
            <span className="rounded-sm border border-destructive/40 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
              Needs reconnect
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={state.busy !== null}
              onClick={() => void reconnect()}
            >
              {state.busy === 'reconnect' ? 'Redirecting…' : 'Reconnect'}
            </Button>
          </>
        ) : null}
        <span className="ml-auto text-xs text-fg-muted">
          Shared {String([...selected].length)} source{selected.size === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-3 p-3">
        <ProviderSourceHint provider={connection.provider} />
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="h-8 min-w-56 flex-1 rounded-sm border border-border bg-bg px-2 text-sm"
            aria-label="Search provider sources"
            placeholder="Search sources"
            value={query}
            onChange={(event) => {
              dispatch({ type: 'query', query: event.currentTarget.value });
            }}
          />
          <Button size="sm" disabled={state.busy !== null} onClick={() => void save()}>
            {state.busy === 'save' ? 'Saving' : 'Save sharing'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={state.busy !== null}
            onClick={() => {
              dispatch({ type: 'confirmDelete' });
            }}
          >
            Delete
          </Button>
        </div>
        {state.confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <span className="text-destructive">
              Deleting stops active sources powered by this connection.
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={state.busy !== null}
              onClick={() => void deleteConnection()}
            >
              {state.busy === 'delete' ? 'Deleting' : 'Delete connection'}
            </Button>
          </div>
        ) : null}
        {error ? (
          <InlineError
            message={connectionErrorMessage(error)}
            details={error}
            onRetry={() => {
              dispatch({ type: 'error', error: null });
            }}
            retryLabel="Dismiss"
          />
        ) : null}
        {isLoading ? <p className="text-sm text-fg-muted">Loading sources…</p> : null}
        {grouped.map((group) => (
          <ResourceGroup
            key={group.kind}
            title={group.label}
            resources={group.resources}
            selected={selected}
            onToggle={toggle}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderSourceHint({ provider }: { provider: string }) {
  const hint = providerSourceHints[provider];
  if (!hint) return null;
  return (
    <div className="rounded-sm border border-signal/30 bg-signal-soft px-3 py-2 text-sm text-fg">
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1">{hint.body}</p>
        {hint.link ? (
          <a
            className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-signal hover:underline"
            href={hint.link.href}
            target="_blank"
            rel="noreferrer"
          >
            {hint.link.label}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : null}
      </div>
      {hint.detail ? <p className="mt-1 text-fg-muted">{hint.detail}</p> : null}
    </div>
  );
}

function ResourceGroup({
  title,
  resources,
  selected,
  onToggle,
}: {
  title: string;
  resources: ProviderResource[];
  selected: Set<string>;
  onToggle: (resource: ProviderResource) => void;
}) {
  if (resources.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">{title}</h3>
      <div className="max-h-72 overflow-auto rounded-sm border border-border">
        {resources.map((resource) => {
          const key = `${resource.kind}\x00${resource.externalId}`;
          return (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-sm last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => {
                  onToggle(resource);
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{resource.label}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {resourceKindDescription(resource.kind)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function resourceKindDescription(kind: string): string {
  switch (kind) {
    case 'drive.folder':
      return 'Folder files imported into the document drive';
    case 'drive.shared_drive':
      return 'Shared drive files imported into the document drive';
    case 'monday.board':
      return 'Board items, updates, columns, and subitems';
    case 'monday.doc':
      return 'WorkDoc pages imported as cited documents';
    case 'github.org':
      return 'All accessible repositories in this organization';
    case 'github.repo':
      return 'Repository activity and changes';
    case 'linear.team':
      return 'Team issues, projects, comments, and workflow changes';
    case 'slack.channel':
      return 'Channel messages, threads, files, reactions, and edits';
    case 'sentry.org':
      return 'All accessible projects in this organization';
    case 'sentry.project':
      return 'Project issues, resolutions, and releases';
    default:
      return 'Selected provider source';
  }
}

function resourceKindSearchText(kind: string): string {
  return resourceKindDescription(kind).toLowerCase();
}

function activeShareToResource(share: ResourceShare | undefined): ProviderResource | null {
  if (!share) return null;
  return {
    kind: share.resourceKind,
    externalId: share.externalId,
    label: shareDisplayName(share),
  };
}

interface TeamShareRow {
  share: ResourceShare;
  connection: ProviderConnection & { ownerLabel: string; ownerUserId: string };
}

function sourceKey(share: Pick<ResourceShare, 'resourceKind' | 'externalId'>) {
  return `${share.resourceKind}\x00${share.externalId}`;
}

function buildSelectedByConnection(rows: TeamShareRow[], activeShareIdSet: Set<string>) {
  const initial: Record<string, Set<string>> = {};
  for (const row of rows) {
    initial[row.connection.id] ??= new Set<string>();
    if (activeShareIdSet.has(row.share.id)) initial[row.connection.id]?.add(row.share.id);
  }
  return initial;
}

export function TeamSourcesUi({
  rows,
  activeShareIds,
  isAdmin,
}: {
  rows: TeamShareRow[];
  activeShareIds: string[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const activeShareIdSet = useMemo(() => new Set(activeShareIds), [activeShareIds]);
  const activeSourceOwners = useMemo(() => {
    const owners = new Map<string, string>();
    for (const row of rows) {
      if (activeShareIdSet.has(row.share.id)) {
        owners.set(sourceKey(row.share), row.connection.id);
      }
    }
    return owners;
  }, [activeShareIdSet, rows]);
  const activeSelectedByConnection = useMemo(
    () => buildSelectedByConnection(rows, activeShareIdSet),
    [activeShareIdSet, rows],
  );
  const [selectedOverrides, setSelectedOverrides] = useState<Record<string, Set<string>>>({});
  const selectedByConnection = useMemo(
    () => ({ ...activeSelectedByConnection, ...selectedOverrides }),
    [activeSelectedByConnection, selectedOverrides],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No shared provider sources yet. Connection owners can share sources from Personal
        connections.
      </p>
    );
  }

  const groups = new Map<string, TeamShareRow[]>();
  for (const row of rows) {
    const key = row.connection.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  async function activate(providerConnectionId: string) {
    setBusy(providerConnectionId);
    setError(null);
    try {
      const res = await fetch('/api/team/integrations/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerConnectionId,
          resourceShareIds: [...(selectedByConnection[providerConnectionId] ?? new Set())],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSelectedOverrides({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted">
        {isAdmin
          ? 'These sources were shared by connection owners. Select what this Timeline team should sync, then save.'
          : 'These sources were shared by connection owners. Team admins choose what this Timeline team should sync.'}
      </div>
      {error ? (
        <InlineError
          message={connectionErrorMessage(error)}
          details={error}
          onRetry={() => {
            setError(null);
          }}
          retryLabel="Dismiss"
        />
      ) : null}
      {[...groups.entries()].map(([connectionId, groupRows]) => {
        const connection = groupRows[0]?.connection;
        if (!connection) return null;
        const selected = selectedByConnection[connectionId] ?? new Set<string>();
        const selectedRows = groupRows.filter((row) => selected.has(row.share.id));
        const hasActiveSources = groupRows.some((row) => activeShareIdSet.has(row.share.id));
        const replacesAnotherConnection = selectedRows.some((row) => {
          const activeConnectionId = activeSourceOwners.get(sourceKey(row.share));
          return activeConnectionId !== undefined && activeConnectionId !== connectionId;
        });
        const actionLabel = replacesAnotherConnection
          ? 'Replace connection'
          : hasActiveSources
            ? 'Save sources'
            : 'Activate sources';
        return (
          <section key={connectionId} className="rounded-md border border-border bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <span className="text-sm font-medium">{providerLabel(connection.provider)}</span>
              <span className="text-sm text-fg-muted">{connection.displayName}</span>
              <span className="text-xs text-fg-muted">Owner: {connection.ownerLabel}</span>
              <span className="ml-auto text-xs text-fg-muted">
                {selected.size === 0
                  ? 'Available, no sources syncing'
                  : `${String(selected.size)} active`}
              </span>
              {isAdmin ? (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void activate(connectionId)}
                >
                  {busy === connectionId ? 'Saving' : actionLabel}
                </Button>
              ) : null}
            </div>
            <div className="divide-y divide-border">
              {groupRows.map((row) => {
                const checked = selected.has(row.share.id);
                const revoked = Boolean(row.share.revokedAt);
                return (
                  <label key={row.share.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!isAdmin || revoked}
                      checked={checked}
                      onChange={() => {
                        setSelectedOverrides((current) => {
                          const next = new Set(selected);
                          if (next.has(row.share.id)) next.delete(row.share.id);
                          else next.add(row.share.id);
                          return { ...current, [connectionId]: next };
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{shareDisplayName(row.share)}</span>
                    {revoked ? (
                      <>
                        <span className="rounded-sm border border-destructive/40 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
                          Access revoked
                        </span>
                        {isAdmin ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => {
                              setSelectedOverrides((current) => {
                                const next = new Set(selected);
                                next.delete(row.share.id);
                                return { ...current, [connectionId]: next };
                              });
                            }}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
