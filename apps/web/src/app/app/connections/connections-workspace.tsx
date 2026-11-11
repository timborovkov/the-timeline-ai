'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ConnectionsTab,
  ConnectionsToolSheet,
  DirectoryProvider,
  InboundEmailSettings,
  TelegramSetupSnapshot,
} from '@/app/app/connections/connection-directory';
import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import {
  connectionsIntegrationIdFallback,
  connectionsTabFromSearch,
  connectionsTabHref,
  directoryHashOwnerId,
  isConnectionsToolSheet,
  parseConnectionsLocation,
  partitionAdvancedMcpCatalog,
  partitionMcpCatalog,
  partitionMcpServers,
} from '@/app/app/connections/connection-directory';
import { ConnectionsDirectory } from '@/app/app/connections/connections-directory';
import { ConnectionsTabs } from '@/app/app/connections/connections-tabs';
import {
  ConnectionsAgentTools,
  ConnectionsDeveloper,
  ConnectionsToolSheets,
} from '@/app/app/connections/connections-tool-panels';
import { ProviderDetailsPanel } from '@/app/app/connections/provider-details-panel';
import { subscribeToClientUrlChanges } from '@/lib/client-url-changes';
import { connectionsTabFromPathname } from '@/lib/connections';

function writeConnectionsUrl(
  tab: ConnectionsTab,
  hash: string | null,
  mode: 'assign' | 'replace' = 'assign',
) {
  const next = connectionsTabHref(tab, hash);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return;
  if (window.location.pathname === next.split('#')[0]) {
    window.location.hash = hash ?? '';
    return;
  }
  if (mode === 'replace') window.location.replace(next);
  else window.location.assign(next);
}

function readConnectionsLocation(
  providers: DirectoryProvider[],
  connectedRows: IntegrationsPageModel['connectedRows'],
  integrationId?: string,
) {
  return parseConnectionsLocation({
    tab: connectionsTabFromPathname(window.location.pathname),
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
        <output className="block bg-surface-2 px-3 py-2 text-sm text-fg-muted">
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
  email,
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
  email: DirectoryProvider;
  connected: DirectoryProvider[];
  available: DirectoryProvider[];
  inboundEmail: InboundEmailSettings;
  telegramSetup: TelegramSetupSnapshot;
  initialTab?: ConnectionsTab;
  initialHash?: string | null;
  integrationId?: string;
}) {
  const providers = useMemo(
    () => [email, ...connected, ...available],
    [available, connected, email],
  );
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
  const openProvider =
    providers.find((provider) => provider.id === directoryHashOwnerId(hash, providers)) ?? null;
  const openToolSheet: ConnectionsToolSheet | null = isConnectionsToolSheet(hash) ? hash : null;
  const providersRef = useRef(providers);
  const connectedRowsRef = useRef(model.connectedRows);
  const integrationIdRef = useRef(integrationId);
  const dismissedIntegrationIdRef = useRef(false);
  const userTabRef = useRef<ConnectionsTab | null>(null);

  useEffect(() => {
    providersRef.current = providers;
    connectedRowsRef.current = model.connectedRows;
    if (!dismissedIntegrationIdRef.current) integrationIdRef.current = integrationId;
  }, [integrationId, model.connectedRows, providers]);

  useEffect(() => {
    const read = (source: 'initial' | 'hash' | 'popstate') =>
      readConnectionsLocation(
        providersRef.current,
        connectedRowsRef.current,
        connectionsIntegrationIdFallback({
          source,
          dismissed: dismissedIntegrationIdRef.current,
          integrationId: integrationIdRef.current,
        }),
      );
    const applyLocation = (source: 'initial' | 'hash' | 'popstate') => {
      const parsed = read(source);
      const pathTab = connectionsTabFromPathname(window.location.pathname);
      setHash(parsed.hash);
      if (parsed.hash && parsed.tab !== pathTab) {
        userTabRef.current = parsed.tab;
        setTab(parsed.tab);
        writeConnectionsUrl(parsed.tab, parsed.hash, 'replace');
        return;
      }
      if (parsed.hash) {
        userTabRef.current = parsed.tab;
        setTab(parsed.tab);
        return;
      }
      if (source === 'hash' && userTabRef.current) {
        setTab(userTabRef.current);
        return;
      }
      userTabRef.current = parsed.tab;
      setTab(parsed.tab);
    };
    applyLocation('initial');
    const onPopState = () => {
      userTabRef.current = null;
      dismissedIntegrationIdRef.current = false;
      applyLocation('popstate');
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
    dismissedIntegrationIdRef.current = true;
    integrationIdRef.current = undefined;
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
            email={email}
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
            connectable={advancedCatalog.connectable}
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
