'use client';

import {
  filterByDirectoryQuery,
  providerStatusTone,
  type DirectoryProvider,
} from '@/app/app/connections/connection-directory';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { NativeProviderConnectButton } from '@/components/native-provider-connect-button';
import { ProviderLogo } from '@/components/provider-logo';
import { ItemActionGroup } from '@/components/ui/item-actions';

export const CONNECTIONS_ROW_ACTION_CLASS =
  'inline-flex min-h-8 min-w-[4.5rem] items-center justify-end rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-signal/50';

export function ConnectionsEmptyHint({ children }: { children: string }) {
  return <p className="px-3 py-8 text-center text-sm text-fg-muted">{children}</p>;
}

function ProviderAction({ provider }: { provider: DirectoryProvider }) {
  if (provider.primaryAction === 'setup') {
    return (
      <a
        href={`#${provider.id}`}
        aria-label={`Set up: ${provider.id}`}
        className={CONNECTIONS_ROW_ACTION_CLASS}
      >
        Set up
      </a>
    );
  }
  if (provider.primaryAction === 'connect') {
    return (
      <NativeProviderConnectButton
        providerId={provider.id}
        label="Connect"
        disabled={!provider.available}
        className="min-w-[4.5rem] justify-end"
      />
    );
  }
  if (provider.primaryAction === 'reconnect') {
    return (
      <NativeProviderConnectButton
        providerId={provider.id}
        label="Reconnect"
        disabled={!provider.available}
        className="min-w-[4.5rem] justify-end"
      />
    );
  }
  return (
    <a href={`#${provider.id}`} className={CONNECTIONS_ROW_ACTION_CLASS}>
      Open
    </a>
  );
}

function DirectoryProviderRow({
  provider,
  selected,
  showDescription = false,
}: {
  provider: DirectoryProvider;
  selected: boolean;
  showDescription?: boolean;
}) {
  const connected = provider.connected;
  return (
    <div id={provider.id} className="scroll-mt-24">
      <CollectionRow
        selected={selected}
        href={`#${provider.id}`}
        activateLabel={`Open ${provider.label} details`}
      >
        <CollectionRow.Leading>
          <ProviderLogo src={provider.logo} />
        </CollectionRow.Leading>
        <CollectionRow.Title>{provider.label}</CollectionRow.Title>
        {showDescription ? (
          <CollectionRow.Context title={provider.description}>
            {provider.description}
          </CollectionRow.Context>
        ) : null}
        <CollectionRow.Metadata>
          <CollectionStatus
            value={provider.status}
            label={provider.statusLabel}
            tone={connected ? providerStatusTone(provider.status) : 'neutral'}
          />
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          <ItemActionGroup label={`Actions for ${provider.label}`}>
            <ProviderAction provider={provider} />
          </ItemActionGroup>
        </CollectionRow.Actions>
      </CollectionRow>
    </div>
  );
}

function InboxSection({ email, selected }: { email: DirectoryProvider; selected: boolean }) {
  return (
    <section className="min-w-0">
      <div className="flex min-h-8 items-center px-2 sm:px-3">
        <h2 className="text-xs font-medium text-fg-muted">Inbox</h2>
      </div>
      <DirectoryProviderRow provider={email} selected={selected} showDescription />
    </section>
  );
}

export function ConnectionsDirectory({
  email,
  connected,
  available,
  query,
  selectedId,
}: {
  email: DirectoryProvider;
  connected: DirectoryProvider[];
  available: DirectoryProvider[];
  query: string;
  selectedId: string | null;
}) {
  const visibleEmail = filterByDirectoryQuery([email], query)[0] ?? null;
  const visibleConnected = filterByDirectoryQuery(connected, query);
  const visibleAvailable = filterByDirectoryQuery(available, query);

  if (!visibleEmail && visibleConnected.length === 0 && visibleAvailable.length === 0) {
    return (
      <ConnectionsEmptyHint>
        {query.trim() ? 'No matching sources.' : 'No sources available.'}
      </ConnectionsEmptyHint>
    );
  }

  return (
    <div className="[&>section+section]:-mt-px">
      {visibleEmail ? (
        <InboxSection email={visibleEmail} selected={selectedId === visibleEmail.id} />
      ) : null}

      {visibleConnected.length > 0 ? (
        <CollectionGroup count={visibleConnected.length} title="Connected providers">
          {visibleConnected.map((provider) => (
            <DirectoryProviderRow
              key={provider.id}
              provider={provider}
              selected={selectedId === provider.id}
            />
          ))}
        </CollectionGroup>
      ) : null}

      {visibleAvailable.length > 0 ? (
        <CollectionGroup count={visibleAvailable.length} title="Available providers">
          {visibleAvailable.map((provider) => (
            <DirectoryProviderRow
              key={provider.id}
              provider={provider}
              selected={selectedId === provider.id}
              showDescription
            />
          ))}
        </CollectionGroup>
      ) : null}
    </div>
  );
}
