import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

type ConnectedRow = IntegrationsPageModel['connectedRows'][number];

function needsAttention(row: ConnectedRow): boolean {
  return row.attention.length > 0 || Boolean(row.lastError) || Boolean(row.healthPause);
}

export type ProviderRowStatus = 'connected' | 'syncing' | 'attention';

export interface DirectoryProvider {
  id: string;
  label: string;
  description: string;
  logo: string;
  available: boolean;
  connected: boolean;
  status: ProviderRowStatus;
  statusLabel: string;
  primaryAction: 'open' | 'reconnect' | 'connect';
}

export interface InboundEmailSettings {
  inboundEmail: string | null;
  enabled: boolean;
  senders: string[];
  placeholderInbound: boolean;
}

function nativeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function providerRowStatus(input: {
  attention: boolean;
  teamSyncing: boolean;
}): ProviderRowStatus {
  if (input.attention) return 'attention';
  if (input.teamSyncing) return 'syncing';
  return 'connected';
}

export function providerStatusLabel(status: ProviderRowStatus): string {
  switch (status) {
    case 'attention':
      return 'Needs attention';
    case 'syncing':
      return 'Syncing for team';
    case 'connected':
      return 'Connected';
  }
}

export function providerStatusTone(status: ProviderRowStatus): 'danger' | 'success' | 'neutral' {
  return status === 'attention' ? 'danger' : status === 'syncing' ? 'success' : 'success';
}

function providerNeedsReconnect(
  rows: IntegrationsPageModel['connectedRows'],
  owned: IntegrationsPageModel['ownedConnections'],
): boolean {
  if (owned.some((connection) => Boolean(connection.lastError))) return true;
  return rows.some(
    (row) =>
      row.healthPause?.kind === 'auth' ||
      row.healthPause?.kind === 'access_revoked' ||
      row.attention.some(
        (item) => item.category === 'needs_reconnect' || item.category === 'access_revoked',
      ),
  );
}

function matchingNativeProviderId(
  name: string,
  catalog: IntegrationsPageModel['nativeCatalog'],
): string | null {
  const key = nativeKey(name);
  return (
    catalog.find((provider) => nativeKey(provider.id) === key || nativeKey(provider.label) === key)
      ?.id ?? null
  );
}

export function partitionMcpCatalog<T extends { id: string; label: string }>(
  entries: readonly T[],
  catalog: IntegrationsPageModel['nativeCatalog'],
): { advanced: T[]; byProviderId: Map<string, T[]> } {
  const byProviderId = new Map<string, T[]>();
  const advanced: T[] = [];
  for (const entry of entries) {
    const providerId =
      matchingNativeProviderId(entry.id, catalog) ?? matchingNativeProviderId(entry.label, catalog);
    if (!providerId) {
      advanced.push(entry);
      continue;
    }
    const current = byProviderId.get(providerId) ?? [];
    current.push(entry);
    byProviderId.set(providerId, current);
  }
  return { advanced, byProviderId };
}

export function partitionMcpServers<T extends { name: string }>(
  servers: readonly T[],
  catalog: IntegrationsPageModel['nativeCatalog'],
): { advanced: T[]; byProviderId: Map<string, T[]> } {
  const byProviderId = new Map<string, T[]>();
  const advanced: T[] = [];
  for (const server of servers) {
    const providerId = matchingNativeProviderId(server.name, catalog);
    if (!providerId) {
      advanced.push(server);
      continue;
    }
    const current = byProviderId.get(providerId) ?? [];
    current.push(server);
    byProviderId.set(providerId, current);
  }
  return { advanced, byProviderId };
}

export function buildDirectoryProviders(input: {
  model: IntegrationsPageModel;
  slackConnections: number;
}): { connected: DirectoryProvider[]; available: DirectoryProvider[] } {
  const connected: DirectoryProvider[] = [];
  const available: DirectoryProvider[] = [];
  for (const provider of input.model.nativeCatalog) {
    const providerRows = input.model.connectedRows.filter((row) => row.provider === provider.id);
    const owned = input.model.ownedConnections.filter((row) => row.provider === provider.id);
    const shares = input.model.teamSourceRows.filter(
      (row) => row.connection.provider === provider.id,
    );
    const slackCapture = provider.id === 'slack' && input.slackConnections > 0;
    const isConnected =
      providerRows.length > 0 || owned.length > 0 || shares.length > 0 || slackCapture;
    const attention =
      providerRows.some((row) => needsAttention(row)) ||
      owned.some((row) => Boolean(row.lastError));
    const teamSyncing = providerRows.some((row) => row.enabled && !needsAttention(row));
    const status = isConnected ? providerRowStatus({ attention, teamSyncing }) : 'connected';
    const primaryAction: DirectoryProvider['primaryAction'] = !isConnected
      ? 'connect'
      : attention && providerNeedsReconnect(providerRows, owned)
        ? 'reconnect'
        : 'open';
    const entry: DirectoryProvider = {
      id: provider.id,
      label: provider.label,
      description: provider.description,
      logo: provider.logo,
      available: provider.available,
      connected: isConnected,
      status: isConnected ? status : 'connected',
      statusLabel: isConnected
        ? providerStatusLabel(status)
        : provider.available
          ? 'Not connected'
          : 'Setup required',
      primaryAction,
    };
    if (isConnected) connected.push(entry);
    else available.push(entry);
  }
  return { connected, available };
}

export function filterAvailableProviders(
  providers: readonly DirectoryProvider[],
  query: string,
): DirectoryProvider[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...providers];
  return providers.filter(
    (provider) =>
      provider.label.toLowerCase().includes(needle) ||
      provider.id.toLowerCase().includes(needle) ||
      provider.description.toLowerCase().includes(needle),
  );
}

export function initialOpenProviderId(input: {
  providers: readonly DirectoryProvider[];
  connectedRows: IntegrationsPageModel['connectedRows'];
  integrationId?: string;
  hash?: string;
}): string | null {
  const hash = input.hash?.replace(/^#/, '') ?? '';
  if (hash && input.providers.some((provider) => provider.id === hash)) return hash;
  if (!input.integrationId) return null;
  const row = input.connectedRows.find((item) => item.id === input.integrationId);
  return row?.provider ?? null;
}

export function connectionHeaderMetadata(
  teamName: string,
  connectedCount: number,
  attentionCount: number,
  availableCount: number,
) {
  return [
    { label: 'Team', value: teamName },
    { label: 'Connected', value: connectedCount, mono: true as const },
    ...(attentionCount > 0
      ? ([
          { label: 'Attention', value: attentionCount, mono: true as const, danger: true as const },
        ] as const)
      : ([] as const)),
    ...(availableCount > 0
      ? ([{ label: 'Available', value: availableCount, mono: true as const }] as const)
      : ([] as const)),
  ];
}
