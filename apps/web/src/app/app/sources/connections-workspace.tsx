'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ConnectionsTab,
  ConnectionsToolSheet,
  DirectoryProvider,
  InboundEmailSettings,
  TelegramSetupSnapshot,
} from '@/app/app/sources/connection-directory';
import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import {
  connectionsHref,
  connectionsTabFromSearch,
  isConnectionsToolSheet,
  parseConnectionsLocation,
  partitionAdvancedMcpCatalog,
  partitionMcpCatalog,
  partitionMcpServers,
} from '@/app/app/sources/connection-directory';
import { ConnectionsDirectory } from '@/app/app/sources/connections-directory';
import { ConnectionsTabs } from '@/app/app/sources/connections-tabs';
import {
  ConnectionsAgentTools,
  ConnectionsDeveloper,
  ConnectionsToolSheets,
} from '@/app/app/sources/connections-tool-panels';
import { ProviderDetailsPanel } from '@/app/app/sources/provider-details-panel';
import { subscribeToClientUrlChanges } from '@/lib/client-url-changes';

function writeConnectionsUrl(tab: ConnectionsTab, hash: string | null) {
  const next = connectionsHref(tab, hash);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return;
  const nextPathAndSearch = next.split('#')[0] ?? next;
  const currentPathAndSearch = `${window.location.pathname}${window.location.search}`;
  if (currentPathAndSearch === nextPathAndSearch) {
    window.location.hash = hash ?? '';
    return;
  }
  window.location.assign(next);
}

function readConnectionsLocation(
  providers: DirectoryProvider[],
  connectedRows: IntegrationsPageModel['connectedRows'],
  integrationId?: string,
) {
  return parseConnectionsLocation({
    tab: new URLSearchParams(window.location.search).get('tab'),
    hash: window.location.hash,
    providers,
    connectedRows,
    integrationId,
  });
}

function ConnectionHealthNotices({ model }: { model: IntegrationsPageModel }) {
  if (model.blockingAttentionCount === 0 && model.webhookDegradedCount === 0) return null;
  return (
    <div className="space-y-2">
      {model.blockingAttentionCount > 0 ? (
        <div
          role="alert"
          className="border-y border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {String(model.blockingAttentionCount)} integration item
          {model.blockingAttentionCount === 1 ? '' : 's'} need attention. Open the affected provider
          to reconnect, replace the connection, or retry failed sync.
        </div>
      ) : null}
      {model.webhookDegradedCount > 0 ? (
        <output className="block border-y border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          {String(model.webhookDegradedCount)} webhook subscription
          {model.webhookDegradedCount === 1 ? '' : 's'} degraded. Reconciliation remains active
          while provider webhook delivery is repaired.
        </output>
      ) : null}
    </div>
  );
}

export function ConnectionsWorkspace({
  isAdmin,
  model,
  connected,
  available,
  inboundEmail,
  telegramSetup,
  initialTab,
  initialHash,
  integrationId,
}: {
  isAdmin: boolean;
  model: IntegrationsPageModel;
  connected: DirectoryProvider[];
  available: DirectoryProvider[];
  inboundEmail: InboundEmailSettings;
  telegramSetup: TelegramSetupSnapshot;
  initialTab?: ConnectionsTab;
  initialHash?: string | null;
  integrationId?: string;
}) {
  const providers = useMemo(() => [...connected, ...available], [available, connected]);
  const mcpByProvider = useMemo(
    () => partitionMcpCatalog(model.mcpCatalogAvailable, model.nativeCatalog),
    [model.mcpCatalogAvailable, model.nativeCatalog],
  );
  const mcpServers = useMemo(
    () => partitionMcpServers(model.mcpServerRows, model.nativeCatalog),
    [model.mcpServerRows, model.nativeCatalog],
  );
  const advancedCatalog = useMemo(
    () => partitionAdvancedMcpCatalog(mcpByProvider.advanced),
    [mcpByProvider.advanced],
  );
  const [tab, setTab] = useState<ConnectionsTab>(initialTab ?? 'sources');
  const [hash, setHash] = useState<string | null>(initialHash ?? null);
  const [queryByTab, setQueryByTab] = useState<Record<ConnectionsTab, string>>({
    sources: '',
    agent: '',
    developer: '',
  });
  const query = queryByTab[tab];
  const openProvider = providers.find((provider) => provider.id === hash) ?? null;
  const openToolSheet: ConnectionsToolSheet | null = isConnectionsToolSheet(hash) ? hash : null;
  const providersRef = useRef(providers);
  const connectedRowsRef = useRef(model.connectedRows);
  const integrationIdRef = useRef(integrationId);
  const userTabRef = useRef<ConnectionsTab | null>(null);

  useEffect(() => {
    providersRef.current = providers;
    connectedRowsRef.current = model.connectedRows;
    integrationIdRef.current = integrationId;
  }, [integrationId, model.connectedRows, providers]);

  useEffect(() => {
    const read = () =>
      readConnectionsLocation(
        providersRef.current,
        connectedRowsRef.current,
        integrationIdRef.current,
      );
    const applyLocation = (mode: 'all' | 'hash') => {
      const parsed = read();
      setHash(parsed.hash);
      if (parsed.hash) {
        userTabRef.current = parsed.tab;
        setTab(parsed.tab);
        return;
      }
      if (mode !== 'all' && userTabRef.current) {
        setTab(userTabRef.current);
        return;
      }
      userTabRef.current = parsed.tab;
      setTab(parsed.tab);
    };
    applyLocation('all');
    const onPopState = () => {
      userTabRef.current = null;
      applyLocation('all');
    };
    window.addEventListener('popstate', onPopState);
    const stop = subscribeToClientUrlChanges(() => {
      applyLocation('hash');
    });
    return () => {
      window.removeEventListener('popstate', onPopState);
      stop();
    };
  }, []);

  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: 'nearest' });
  }, [hash, tab]);

  function selectTab(next: ConnectionsTab) {
    const keepHash =
      hash &&
      parseConnectionsLocation({
        hash,
        providers,
        connectedRows: model.connectedRows,
      }).tab === next
        ? hash
        : null;
    userTabRef.current = next;
    setTab(next);
    setHash(keepHash);
    writeConnectionsUrl(next, keepHash);
  }

  function openHash(nextHash: string) {
    const parsed = parseConnectionsLocation({
      tab: connectionsTabFromSearch(nextHash),
      hash: nextHash,
      providers,
      connectedRows: model.connectedRows,
    });
    userTabRef.current = parsed.tab;
    setTab(parsed.tab);
    setHash(parsed.hash);
    writeConnectionsUrl(parsed.tab, parsed.hash);
  }

  function closeSheet() {
    setHash(null);
    writeConnectionsUrl(tab, null);
  }

  return (
    <div className="space-y-4">
      <ConnectionsTabs
        tab={tab}
        onChange={selectTab}
        query={query}
        onQueryChange={(value) => {
          setQueryByTab((current) => ({ ...current, [tab]: value }));
        }}
      />
      <ConnectionHealthNotices model={model} />
      <div
        role="tabpanel"
        id={`connections-panel-${tab}`}
        aria-labelledby={`connections-tab-${tab}`}
      >
        {tab === 'sources' ? (
          <ConnectionsDirectory
            connected={connected}
            available={available}
            query={query}
            selectedId={openProvider?.id ?? null}
          />
        ) : null}
        {tab === 'agent' ? (
          <ConnectionsAgentTools
            isAdmin={isAdmin}
            mcpServers={mcpServers.advanced}
            comingSoon={advancedCatalog.comingSoon}
            query={query}
            selectedId={openToolSheet}
            onOpenSheet={openHash}
          />
        ) : null}
        {tab === 'developer' ? (
          <ConnectionsDeveloper
            isAdmin={isAdmin}
            webhookCount={model.ingestWebhookList.length}
            selectedId={openToolSheet}
            onOpenSheet={openHash}
          />
        ) : null}
      </div>

      <ProviderDetailsPanel
        provider={openProvider}
        open={openProvider !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeSheet();
        }}
        isAdmin={isAdmin}
        model={model}
        ownedConnections={
          openProvider
            ? model.ownedConnections.filter((row) => row.provider === openProvider.id)
            : []
        }
        mcpCatalog={openProvider ? (mcpByProvider.byProviderId.get(openProvider.id) ?? []) : []}
        mcpServers={openProvider ? (mcpServers.byProviderId.get(openProvider.id) ?? []) : []}
        inboundEmail={inboundEmail}
        telegramSetup={telegramSetup}
      />
      <ConnectionsToolSheets
        openSheet={openToolSheet}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeSheet();
        }}
        isAdmin={isAdmin}
        mcpServers={mcpServers.advanced}
        mcpCatalog={advancedCatalog.connectable}
        webhooks={model.ingestWebhookList}
      />
    </div>
  );
}
