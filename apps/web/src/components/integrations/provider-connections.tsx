'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plug, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useReducer, useRef, useState, type RefObject } from 'react';

import { EmptyState } from '@/components/empty-state';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { notifyAction } from '@/lib/notify';
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
  | { type: 'openDeleteConfirmation' }
  | { type: 'closeDeleteConfirmation' }
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
    case 'openDeleteConfirmation':
      return { ...state, confirmDelete: true };
    case 'closeDeleteConfirmation':
      return { ...state, confirmDelete: false };
    case 'resetSelection':
      return { ...state, selectedOverride: null };
  }
}

export function PersonalConnectionsUi({
  connections,
  connectProviderHref = '#connect-provider',
}: {
  connections: ProviderConnection[];
  connectProviderHref?: string;
}) {
  if (connections.length === 0) {
    return (
      <div className="space-y-3">
        <PersonalConnectionFlow />
        <EmptyState
          icon={Plug}
          title="No provider accounts yet"
          body="Connect an account to choose the sources this team may use."
        >
          <Button asChild size="sm">
            <a href={connectProviderHref}>Connect a provider account</a>
          </Button>
        </EmptyState>
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
    <div className="space-y-3 border-y border-border py-3 text-sm">
      <div className="grid gap-2 md:grid-cols-3">
        <div>
          <p className="font-medium text-fg">1. Provider account</p>
          <p className="mt-1 text-fg-muted">Your OAuth grant. It belongs to you, not the team.</p>
        </div>
        <div>
          <p className="font-medium text-fg">2. Shared sources</p>
          <p className="mt-1 text-fg-muted">
            Pick the boards, repos, projects, or channels this team may use.
          </p>
        </div>
        <div>
          <p className="font-medium text-fg">3. Team sync</p>
          <p className="mt-1 text-fg-muted">
            A team admin chooses which shared sources become timeline evidence.
          </p>
        </div>
      </div>
    </div>
  );
}

function TeamSyncFlow({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted">
      {isAdmin
        ? 'Shared sources are not syncing yet. Select the sources this team should import, then activate team sync.'
        : 'Shared sources are not syncing yet. A team admin chooses which shared sources this team imports.'}
    </div>
  );
}

function TeamSyncStatus({
  selectedSize,
  hasActiveSources,
}: {
  selectedSize: number;
  hasActiveSources: boolean;
}) {
  if (selectedSize === 0) {
    return (
      <span className="text-xs text-fg-muted sm:text-right">
        {hasActiveSources ? 'Team sync paused' : 'Shared, not syncing'}
      </span>
    );
  }
  return (
    <span className="text-xs text-fg-muted sm:text-right">
      {String(selectedSize)} source{selectedSize === 1 ? '' : 's'} selected for team sync
    </span>
  );
}

function TeamConnectionRoleLine({ ownerLabel }: { ownerLabel: string }) {
  return (
    <p className="mt-0.5 truncate text-xs text-fg-muted">Provider account owner: {ownerLabel}</p>
  );
}

function PersonalConnectionRoleLine({ lastConnectedAt }: { lastConnectedAt: string }) {
  return (
    <p className="mt-0.5 truncate text-xs text-fg-muted">
      Personal provider account · Connected {new Date(lastConnectedAt).toLocaleDateString()}
    </p>
  );
}

function ProviderAccountHint({ provider }: { provider: string }) {
  if (provider !== 'monday') return null;
  return (
    <p className="rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-xs text-fg-muted">
      To add another Monday.com account, start Connect account again and choose a different account
      in Monday.com before approving.
    </p>
  );
}

function PersonalConnectionHeader({ connection }: { connection: ProviderConnection }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{providerLabel(connection.provider)}</span>
        <span className="min-w-0 max-w-full break-words text-sm text-fg-muted">
          {connection.displayName}
        </span>
      </div>
      <PersonalConnectionRoleLine lastConnectedAt={connection.lastConnectedAt} />
    </div>
  );
}

function TeamConnectionHeader({ connection }: { connection: TeamShareRow['connection'] }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{providerLabel(connection.provider)}</span>
        <span className="min-w-0 truncate text-sm text-fg-muted">{connection.displayName}</span>
      </div>
      <TeamConnectionRoleLine ownerLabel={connection.ownerLabel} />
    </div>
  );
}

function PersonalConnectionToolbar({
  selectedSize,
  busy,
  isSourcesLoading,
  hasSourceLoadError,
  confirmingDeletion,
  deleteButtonRef,
  onSave,
  onDelete,
}: {
  selectedSize: number;
  busy: SourcePickerState['busy'];
  isSourcesLoading: boolean;
  hasSourceLoadError: boolean;
  confirmingDeletion: boolean;
  deleteButtonRef: React.RefObject<HTMLButtonElement | null>;
  onSave: () => void;
  onDelete: () => void;
}) {
  const canSave = !isSourcesLoading && !hasSourceLoadError;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        {isSourcesLoading ? (
          <>
            <p className="text-sm font-medium text-fg">Loading shared sources</p>
            <p className="text-xs text-fg-muted">Saving will be available when sources load.</p>
          </>
        ) : hasSourceLoadError ? (
          <>
            <p className="text-sm font-medium text-fg">Unable to load shared sources</p>
            <p className="text-xs text-fg-muted">Retry loading sources before saving changes.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-fg">
              {String(selectedSize)} source{selectedSize === 1 ? '' : 's'} shared to this team
            </p>
            <p className="text-xs text-fg-muted">
              Sharing allows team admins to activate sync later.
            </p>
          </>
        )}
      </div>
      <ItemActionGroup label="Actions for this provider account" className="sm:ml-auto">
        <Button size="sm" className="min-h-9" disabled={busy !== null || !canSave} onClick={onSave}>
          {busy === 'save' ? 'Saving' : 'Save sharing'}
        </Button>
        <ItemOverflowMenu targetLabel="this provider account" triggerRef={deleteButtonRef}>
          <DropdownMenuItem
            disabled={busy !== null || confirmingDeletion}
            className="text-destructive focus:text-destructive"
            onSelect={onDelete}
          >
            Delete account
          </DropdownMenuItem>
        </ItemOverflowMenu>
      </ItemActionGroup>
    </div>
  );
}

function ConnectionSources({ connection }: { connection: ProviderConnection }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(sourcePickerReducer, initialSourcePickerState);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputId = useId();
  const deleteConfirmationId = useId();
  const {
    data,
    error: queryError,
    isLoading,
    isFetching,
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
  const resourceByKey = useMemo(() => {
    return new Map(resources.map((resource) => [resourceKey(resource), resource]));
  }, [resources]);
  const savedSelected = useMemo(() => {
    const next = new Set<string>();
    for (const share of shares) {
      const key = shareKey(share);
      const isMissingMondayBoard =
        connection.provider === 'monday' &&
        share.resourceKind === 'monday.board' &&
        !resourceByKey.has(key);
      if (!share.revokedAt && !isMissingMondayBoard) {
        next.add(key);
      }
    }
    return next;
  }, [connection.provider, resourceByKey, shares]);
  const selected = state.selectedOverride ?? savedSelected;
  const sourceLoadError = queryError instanceof Error ? queryError.message : null;
  const error = sourceLoadError;
  const query = state.query;

  const activeShareByKey = useMemo(() => {
    const next = new Map<string, ResourceShare>();
    for (const share of shares) {
      const key = shareKey(share);
      const isMissingMondayBoard =
        connection.provider === 'monday' &&
        share.resourceKind === 'monday.board' &&
        !resourceByKey.has(key);
      if (!share.revokedAt && !isMissingMondayBoard) {
        next.set(key, share);
      }
    }
    return next;
  }, [connection.provider, resourceByKey, shares]);
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
  const hasSearchQuery = Boolean(query.trim());
  const showEmptyResult = !isLoading && !queryError && grouped.length === 0;

  function clearSearch() {
    dispatch({ type: 'query', query: '' });
    searchInputRef.current?.focus();
  }

  async function retrySourceLoad() {
    dispatch({ type: 'error', error: null });
    await refetch();
  }

  function toggle(resource: ProviderResource) {
    dispatch({ type: 'toggle', key: resourceKey(resource), currentSelected: selected });
  }

  async function save() {
    dispatch({ type: 'busy', busy: 'save' });
    dispatch({ type: 'error', error: null });
    const chosen = [...selected]
      .map((key) => resourceByKey.get(key) ?? activeShareToResource(activeShareByKey.get(key)))
      .filter((resource): resource is ProviderResource => Boolean(resource));
    const result = await notifyAction({
      id: `connection:${connection.id}:save`,
      loading: 'Saving sources…',
      success: 'Sources saved',
      error: 'Couldn’t save sources',
      run: async () => {
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
          if (!res.ok) await readJsonResponse(res);
          await refetch();
          return { ok: true };
        } catch {
          return { error: 'failed' };
        }
      },
    });
    dispatch({ type: 'busy', busy: null });
    if (result.error) return;
    dispatch({ type: 'resetSelection' });
    router.refresh();
  }

  async function deleteConnection() {
    dispatch({ type: 'busy', busy: 'delete' });
    dispatch({ type: 'error', error: null });
    const result = await notifyAction({
      id: `connection:${connection.id}:delete`,
      loading: 'Deleting provider account…',
      success: 'Provider account deleted',
      error: 'Couldn’t delete provider account',
      run: async () => {
        try {
          const res = await fetch(`/api/connections/${connection.id}`, { method: 'DELETE' });
          await readJsonResponse(res);
          return { ok: true };
        } catch {
          return { error: 'failed' };
        }
      },
    });
    dispatch({ type: 'busy', busy: null });
    if (!result.error) router.refresh();
  }

  async function reconnect() {
    dispatch({ type: 'busy', busy: 'reconnect' });
    dispatch({ type: 'error', error: null });
    const result = await notifyAction({
      id: `connection:${connection.id}:reconnect`,
      loading: 'Opening sign-in…',
      success: 'Opening sign-in',
      error: 'Couldn’t start reconnection',
      run: async () => {
        const res = await fetch(`/api/integrations/${connection.provider}/start`, {
          method: 'POST',
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          return { error: data.error ?? connectionErrorMessage(data.error, res.status) };
        }
        window.location.href = data.url;
        return { ok: true };
      },
    });
    dispatch({ type: 'busy', busy: null });
    if (result.error) return;
  }

  return (
    <ConnectionSourcesPanel
      connection={connection}
      selected={selected}
      query={query}
      searchInputId={searchInputId}
      searchInputRef={searchInputRef}
      deleteConfirmationId={deleteConfirmationId}
      deleteButtonRef={deleteButtonRef}
      busy={state.busy}
      confirmDelete={state.confirmDelete}
      error={error}
      sourceLoadError={sourceLoadError}
      picker={{
        isLoading,
        isFetching,
        showEmptyResult,
        hasSearchQuery,
      }}
      grouped={grouped}
      onQueryChange={(nextQuery) => {
        dispatch({ type: 'query', query: nextQuery });
      }}
      onSave={() => void save()}
      onDelete={() => {
        dispatch({ type: 'openDeleteConfirmation' });
      }}
      onConfirmDelete={() => void deleteConnection()}
      onCancelDelete={() => {
        dispatch({ type: 'closeDeleteConfirmation' });
        deleteButtonRef.current?.focus();
      }}
      onReconnect={() => void reconnect()}
      onRetry={() => {
        void retrySourceLoad();
      }}
      onToggle={toggle}
      onClearSearch={clearSearch}
    />
  );
}

function ConnectionSourcesPanel({
  connection,
  selected,
  query,
  searchInputId,
  searchInputRef,
  deleteConfirmationId,
  deleteButtonRef,
  busy,
  confirmDelete,
  error,
  sourceLoadError,
  picker,
  grouped,
  onQueryChange,
  onSave,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onReconnect,
  onRetry,
  onToggle,
  onClearSearch,
}: {
  connection: ProviderConnection;
  selected: Set<string>;
  query: string;
  searchInputId: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  deleteConfirmationId: string;
  deleteButtonRef: RefObject<HTMLButtonElement | null>;
  busy: SourcePickerState['busy'];
  confirmDelete: boolean;
  error: string | null;
  sourceLoadError: string | null;
  picker: {
    isLoading: boolean;
    isFetching: boolean;
    showEmptyResult: boolean;
    hasSearchQuery: boolean;
  };
  grouped: ReturnType<typeof groupResourcesByKind>;
  onQueryChange: (query: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onReconnect: () => void;
  onRetry: () => void;
  onToggle: (resource: ProviderResource) => void;
  onClearSearch: () => void;
}) {
  return (
    <section
      aria-label={`${providerLabel(connection.provider)} account ${connection.displayName}`}
      className="border-y border-border"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <PersonalConnectionHeader connection={connection} />
        </div>
        {connection.lastError ? (
          <>
            <span className="rounded-sm border border-destructive/40 px-1.5 py-0.5 text-xs text-destructive">
              Needs reconnect
            </span>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={onReconnect}>
              {busy === 'reconnect' ? 'Redirecting…' : 'Reconnect'}
            </Button>
          </>
        ) : null}
        <span className="text-xs text-fg-muted">
          Shared {String([...selected].length)} source{selected.size === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-3 p-3">
        <ProviderAccountHint provider={connection.provider} />
        <ProviderSourceHint provider={connection.provider} />
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={searchInputId} className="block text-xs font-medium text-fg">
              Search sources
            </label>
            <Input
              ref={searchInputRef}
              id={searchInputId}
              className="text-base sm:text-sm"
              placeholder="Search by name or type"
              value={query}
              onChange={(event) => {
                onQueryChange(event.currentTarget.value);
              }}
            />
          </div>
          <PersonalConnectionToolbar
            selectedSize={selected.size}
            busy={busy}
            isSourcesLoading={picker.isLoading}
            hasSourceLoadError={Boolean(sourceLoadError)}
            confirmingDeletion={confirmDelete}
            deleteButtonRef={deleteButtonRef}
            onSave={onSave}
            onDelete={onDelete}
          />
        </div>
        {confirmDelete ? (
          <section
            id={deleteConfirmationId}
            aria-label="Confirm provider account deletion"
            className="flex flex-wrap items-center gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          >
            <p role="status" className="min-w-0 flex-1 text-destructive">
              Deleting this provider account stops team sync that depends on it.
            </p>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null}
              onClick={onConfirmDelete}
            >
              {busy === 'delete' ? 'Deleting' : 'Delete provider account'}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={onCancelDelete}>
              Cancel
            </Button>
          </section>
        ) : null}
        {error ? (
          <InlineError
            message={connectionErrorMessage(error)}
            details={error}
            onRetry={onRetry}
            retryLabel="Retry loading sources"
            retrying={picker.isFetching}
          />
        ) : null}
        {picker.isLoading ? <SourcePickerLoading /> : null}
        {grouped.map((group) => (
          <ResourceGroup
            key={group.kind}
            title={group.label}
            resources={group.resources}
            selected={selected}
            onToggle={onToggle}
          />
        ))}
        {picker.showEmptyResult ? (
          <SourcePickerEmptyState
            query={query}
            hasSearchQuery={picker.hasSearchQuery}
            onClearSearch={onClearSearch}
          />
        ) : null}
      </div>
    </section>
  );
}

function SourcePickerLoading() {
  return (
    <div aria-busy="true" aria-label="Loading provider sources" className="space-y-2">
      <p role="status" className="sr-only">
        Loading provider sources
      </p>
      <div aria-hidden="true" className="rounded-sm border border-border p-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="mt-2 h-10 w-full" />
        <Skeleton className="mt-2 h-10 w-full" />
      </div>
    </div>
  );
}

function SourcePickerEmptyState({
  query,
  hasSearchQuery,
  onClearSearch,
}: {
  query: string;
  hasSearchQuery: boolean;
  onClearSearch: () => void;
}) {
  if (hasSearchQuery) {
    return (
      <EmptyState
        icon={Search}
        size="compact"
        title={`No sources match “${query.trim()}”`}
        body="Clear the search to see every shareable source on this account."
      >
        <Button size="sm" variant="outline" onClick={onClearSearch}>
          Clear search
        </Button>
      </EmptyState>
    );
  }

  return (
    <EmptyState
      icon={Plug}
      size="compact"
      title="No shareable sources found"
      body="This provider account does not currently expose any sources you can share with this team."
    />
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
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-signal hover:underline"
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
      <h3 className="text-xs text-fg-muted">{title}</h3>
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
                <span className="block break-words">{resource.label}</span>
                <span className="block break-words text-xs text-fg-muted">
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
    const selected = (initial[row.connection.id] ??= new Set<string>());
    if (activeShareIdSet.has(row.share.id)) selected.add(row.share.id);
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

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        size="inset"
        title="No shared provider sources yet"
        body="Connection owners can share sources from Personal connections so this team can import them."
      />
    );
  }

  const groups = new Map<string, TeamShareRow[]>();
  for (const row of rows) {
    const key = row.connection.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  async function activate(providerConnectionId: string) {
    setBusy(providerConnectionId);
    const outcome = { success: 'Team sync saved' };
    const result = await notifyAction({
      id: `integration:activate:${providerConnectionId}`,
      loading: 'Saving team sync…',
      get success() {
        return outcome.success;
      },
      error: 'Couldn’t save team sync',
      run: async () => {
        const res = await fetch('/api/team/integrations/activate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerConnectionId,
            resourceShareIds: [...(selectedByConnection[providerConnectionId] ?? new Set())],
          }),
        });
        const payload = await readJsonResponse<{
          error?: string;
          syncRequired?: boolean;
          syncQueued?: boolean;
        }>(res);
        if (payload.error) return { error: payload.error };
        outcome.success = !payload.syncRequired
          ? 'Team sync sources saved. No historical import was needed.'
          : payload.syncQueued
            ? 'Initial import queued. Older items will be available after the first sync completes.'
            : 'Sources were saved, but the initial import could not be queued. Retry team sync.';
        setSelectedOverrides({});
        return { ok: true };
      },
    });
    setBusy(null);
    if (!result.error) router.refresh();
  }

  return (
    <div className="space-y-3">
      <TeamSyncFlow isAdmin={isAdmin} />
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
          ? 'Replace active import'
          : hasActiveSources
            ? 'Save team sync'
            : 'Activate team sync';
        return (
          <section key={connectionId} className="border-y border-border">
            <div className="grid gap-2 border-b border-border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <TeamConnectionHeader connection={connection} />
              <TeamSyncStatus selectedSize={selected.size} hasActiveSources={hasActiveSources} />
              {isAdmin ? (
                <Button
                  size="sm"
                  className="w-full sm:w-auto"
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
