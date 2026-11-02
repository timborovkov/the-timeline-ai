'use client';

import { Plug, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type {
  DirectoryProvider,
  InboundEmailSettings,
  TelegramSetupSnapshot,
} from '@/app/app/sources/connection-directory';
import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import {
  filterAvailableProviders,
  initialOpenProviderId,
  partitionMcpCatalog,
  partitionMcpServers,
  providerStatusTone,
} from '@/app/app/sources/connection-directory';
import { ProviderDetailsPanel } from '@/app/app/sources/provider-details-panel';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { EmptyState } from '@/components/empty-state';
import { NativeProviderConnectButton } from '@/components/native-provider-connect-button';
import { ProviderLogo } from '@/components/provider-logo';
import { Input } from '@/components/ui/input';
import { ItemActionGroup } from '@/components/ui/item-actions';

const ROW_ACTION_CLASS =
  'inline-flex min-h-8 items-center rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-signal/50';

function ProviderAction({ provider, onOpen }: { provider: DirectoryProvider; onOpen: () => void }) {
  if (provider.primaryAction === 'setup') {
    return (
      <button
        type="button"
        aria-label={`Set up: ${provider.id}`}
        className={ROW_ACTION_CLASS}
        onClick={onOpen}
      >
        Set up
      </button>
    );
  }
  if (provider.primaryAction === 'connect') {
    return (
      <NativeProviderConnectButton
        providerId={provider.id}
        label="Connect"
        disabled={!provider.available}
      />
    );
  }
  if (provider.primaryAction === 'reconnect') {
    return (
      <NativeProviderConnectButton
        providerId={provider.id}
        label="Reconnect"
        disabled={!provider.available}
      />
    );
  }
  return (
    <button type="button" className={ROW_ACTION_CLASS} onClick={onOpen}>
      Open
    </button>
  );
}

function DirectoryProviderRow({
  provider,
  onOpen,
}: {
  provider: DirectoryProvider;
  onOpen?: () => void;
}) {
  const connected = provider.connected;
  const slots = [
    <CollectionRow.Leading key="leading">
      <ProviderLogo src={provider.logo} />
    </CollectionRow.Leading>,
    <CollectionRow.Title key="title">{provider.label}</CollectionRow.Title>,
    <CollectionRow.Metadata key="metadata">
      <CollectionStatus
        value={provider.status}
        label={provider.statusLabel}
        tone={connected ? providerStatusTone(provider.status) : 'neutral'}
      />
    </CollectionRow.Metadata>,
    <CollectionRow.Actions key="actions">
      <ItemActionGroup label={`Actions for ${provider.label}`}>
        <ProviderAction
          provider={provider}
          onOpen={
            onOpen ??
            (() => {
              return;
            })
          }
        />
      </ItemActionGroup>
    </CollectionRow.Actions>,
  ];
  return (
    <div id={provider.id} className="scroll-mt-24">
      {onOpen ? (
        <CollectionRow onActivate={onOpen} activateLabel={`Open ${provider.label} details`}>
          {slots}
        </CollectionRow>
      ) : (
        <CollectionRow>{slots}</CollectionRow>
      )}
    </div>
  );
}

export function ConnectionsDirectory({
  isAdmin,
  model,
  connected,
  available,
  initialProviderId,
  inboundEmail,
  telegramSetup,
}: {
  isAdmin: boolean;
  model: IntegrationsPageModel;
  connected: DirectoryProvider[];
  available: DirectoryProvider[];
  initialProviderId?: string | null;
  inboundEmail: InboundEmailSettings;
  telegramSetup: TelegramSetupSnapshot;
}) {
  const [query, setQuery] = useState('');
  const [openProviderId, setOpenProviderId] = useState<string | null>(initialProviderId ?? null);
  const visibleAvailable = useMemo(
    () => filterAvailableProviders(available, query),
    [available, query],
  );
  const mcpCatalog = useMemo(
    () => partitionMcpCatalog(model.mcpCatalogAvailable, model.nativeCatalog),
    [model.mcpCatalogAvailable, model.nativeCatalog],
  );
  const mcpServers = useMemo(
    () => partitionMcpServers(model.mcpServerRows, model.nativeCatalog),
    [model.mcpServerRows, model.nativeCatalog],
  );
  const openProvider =
    connected.find((provider) => provider.id === openProviderId) ??
    available.find((provider) => provider.id === openProviderId) ??
    null;

  useEffect(() => {
    const fromHash = initialOpenProviderId({
      providers: [...connected, ...available],
      connectedRows: model.connectedRows,
      hash: window.location.hash,
    });
    if (fromHash) setOpenProviderId(fromHash);
  }, [available, connected, model.connectedRows]);

  return (
    <>
      {connected.length > 0 ? (
        <CollectionGroup count={connected.length} title="Connected providers">
          {connected.map((provider) => (
            <DirectoryProviderRow
              key={provider.id}
              provider={provider}
              onOpen={() => {
                setOpenProviderId(provider.id);
              }}
            />
          ))}
        </CollectionGroup>
      ) : (
        <EmptyState
          icon={Plug}
          size="inset"
          title="No providers connected"
          body="Connect a provider below to sync work into this team."
        />
      )}

      {available.length > 0 ? (
        <section className="space-y-2">
          <CollectionGroup
            count={visibleAvailable.length}
            title="Available providers"
            actions={
              available.length > 1 ? (
                <label className="relative flex min-w-40 items-center">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2 size-3.5 text-fg-dim"
                  />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.currentTarget.value);
                    }}
                    placeholder="Search"
                    aria-label="Search available providers"
                    className="h-8 pl-7 text-sm"
                  />
                </label>
              ) : null
            }
          >
            {visibleAvailable.length > 0 ? (
              visibleAvailable.map((provider) => (
                <DirectoryProviderRow
                  key={provider.id}
                  provider={provider}
                  onOpen={
                    provider.kind === 'capture'
                      ? () => {
                          setOpenProviderId(provider.id);
                        }
                      : undefined
                  }
                />
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-fg-muted">No matching providers.</p>
            )}
          </CollectionGroup>
        </section>
      ) : null}

      <ProviderDetailsPanel
        provider={openProvider}
        open={openProvider !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOpenProviderId(null);
        }}
        isAdmin={isAdmin}
        model={model}
        ownedConnections={
          openProvider
            ? model.ownedConnections.filter((row) => row.provider === openProvider.id)
            : []
        }
        mcpCatalog={openProvider ? (mcpCatalog.byProviderId.get(openProvider.id) ?? []) : []}
        mcpServers={openProvider ? (mcpServers.byProviderId.get(openProvider.id) ?? []) : []}
        inboundEmail={inboundEmail}
        telegramSetup={telegramSetup}
      />
    </>
  );
}
