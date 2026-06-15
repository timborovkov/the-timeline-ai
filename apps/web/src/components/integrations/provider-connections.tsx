'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState } from 'react';

import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';

interface ProviderResource {
  kind: string;
  externalId: string;
  label: string;
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
  | { type: 'busy'; busy: 'save' | 'delete' | null }
  | { type: 'error'; error: string | null }
  | { type: 'confirmDelete' }
  | { type: 'resetSelection' };

interface SourcePickerState {
  selectedOverride: Set<string> | null;
  query: string;
  busy: 'save' | 'delete' | null;
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
      <div className="rounded-sm border border-dashed border-border bg-surface p-4 text-sm text-fg-muted">
        No provider connections yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {connections.map((connection) => (
        <ConnectionSources key={connection.id} connection={connection} />
      ))}
    </div>
  );
}

function ConnectionSources({ connection }: { connection: ProviderConnection }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(sourcePickerReducer, initialSourcePickerState);
  const {
    data: resourcesData,
    error: resourcesError,
    isLoading: resourcesLoading,
    refetch: refetchResources,
  } = useQuery({
    queryKey: queryKeys.providerConnectionResources(connection.id),
    queryFn: async () => {
      const res = await fetch(`/api/connections/${connection.id}/resources`);
      const data = (await res.json()) as ConnectionResourcesPayload;
      if (!res.ok) throw new Error(data.error ?? 'Failed to load resources');
      return data;
    },
  });

  const resources = resourcesData?.resources ?? emptyResources;
  const shares = resourcesData?.shares ?? emptyShares;
  const savedSelected = useMemo(() => {
    const next = new Set<string>();
    for (const share of shares) {
      if (!share.revokedAt) next.add(shareKey(share));
    }
    return next;
  }, [shares]);
  const selected = state.selectedOverride ?? savedSelected;
  const error = state.error ?? (resourcesError instanceof Error ? resourcesError.message : null);
  const query = state.query;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter(
      (resource) =>
        resource.label.toLowerCase().includes(q) || resource.externalId.toLowerCase().includes(q),
    );
  }, [query, resources]);

  const grouped = useMemo(() => {
    const groups = { orgs: [] as ProviderResource[], sources: [] as ProviderResource[] };
    for (const resource of filtered) {
      if (resource.kind.endsWith('.org')) groups.orgs.push(resource);
      else groups.sources.push(resource);
    }
    return groups;
  }, [filtered]);

  function toggle(resource: ProviderResource) {
    dispatch({ type: 'toggle', key: resourceKey(resource), currentSelected: selected });
  }

  async function save() {
    dispatch({ type: 'busy', busy: 'save' });
    dispatch({ type: 'error', error: null });
    const chosen = resources.filter((resource) => selected.has(resourceKey(resource)));
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
      await refetchResources();
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

  return (
    <section className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
          {connection.provider}
        </span>
        <span className="text-sm font-medium">{connection.displayName}</span>
        {connection.lastError ? (
          <span className="rounded-sm border border-destructive/40 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
            Needs reconnect
          </span>
        ) : null}
        <span className="ml-auto text-xs text-fg-muted">
          Shared {String([...selected].length)} source{selected.size === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-3 p-3">
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {resourcesLoading ? <p className="text-sm text-fg-muted">Loading sources…</p> : null}
        <ResourceGroup
          title="Organizations"
          resources={grouped.orgs}
          selected={selected}
          onToggle={toggle}
        />
        <ResourceGroup
          title="Sources"
          resources={grouped.sources}
          selected={selected}
          onToggle={toggle}
        />
      </div>
    </section>
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
              <span className="min-w-0 flex-1 truncate">{resource.label}</span>
              <span className="font-mono text-[10px] uppercase text-fg-muted">{resource.kind}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
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
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
                {connection.provider}
              </span>
              <span className="text-sm font-medium">{connection.displayName}</span>
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
                    <span className="min-w-0 flex-1 truncate">
                      {row.share.externalLabel ?? row.share.externalId}
                    </span>
                    {revoked ? (
                      <span className="rounded-sm border border-destructive/40 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
                        Access revoked
                      </span>
                    ) : null}
                    <span className="font-mono text-[10px] uppercase text-fg-muted">
                      {row.share.resourceKind}
                    </span>
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
