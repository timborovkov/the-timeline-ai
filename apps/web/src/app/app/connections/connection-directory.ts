import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';
import type { MouseEvent } from 'react';

import {
  CONNECTIONS_TABS,
  connectionsTabFromSearch,
  connectionsTabHref,
  type ConnectionsTab,
} from '@/lib/connections';

export { CONNECTIONS_TABS, connectionsTabFromSearch, connectionsTabHref, type ConnectionsTab };

type ConnectedRow = IntegrationsPageModel['connectedRows'][number];

function needsAttention(row: ConnectedRow): boolean {
  return row.attention.length > 0 || Boolean(row.lastError) || Boolean(row.healthPause);
}

export type ProviderRowStatus = 'connected' | 'syncing' | 'attention';
type DirectoryProviderKind = 'native' | 'capture';
type DirectoryPrimaryAction = 'open' | 'reconnect' | 'connect' | 'setup';

export interface DirectoryProvider {
  id: string;
  label: string;
  description: string;
  logo: string;
  kind: DirectoryProviderKind;
  available: boolean;
  connected: boolean;
  status: ProviderRowStatus;
  statusLabel: string;
  primaryAction: DirectoryPrimaryAction;
}

export interface InboundEmailSettings {
  inboundEmail: string | null;
  enabled: boolean;
  senders: string[];
  placeholderInbound: boolean;
}

export interface TelegramSetupSnapshot {
  botUsername: string | null;
  webhookConfigured: boolean;
  currentUserId: string;
  tokens: {
    id: string;
    scope: 'personal' | 'group';
    expiresAt: string;
    issuedByUserId: string;
  }[];
  bindings: {
    id: string;
    title: string | null;
    tgChatId: number;
    createdAt: string;
  }[];
  linkedUsers: {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    userId: string | null;
    isActive: boolean;
    appName: string | null;
    appEmail: string | null;
  }[];
}

export const EMPTY_TELEGRAM_SETUP: TelegramSetupSnapshot = {
  botUsername: null,
  webhookConfigured: true,
  currentUserId: '',
  tokens: [],
  bindings: [],
  linkedUsers: [],
};

const TELEGRAM_DIRECTORY_PROVIDER = {
  id: 'telegram',
  label: 'Telegram',
  description: 'Capture DMs and group chats through the Timeline bot.',
  logo: '/connectors/telegram.svg',
} as const;

const EMAIL_DIRECTORY_PROVIDER = {
  id: 'email',
  label: 'Email',
  description: 'Forward, CC, or BCC mail to capture it on the timeline.',
  logo: '/connectors/email.svg',
} as const;

function providerOrderRank(id: string): number {
  if (id === 'telegram') return 0;
  if (id === 'slack') return 1;
  return 2;
}

function sortDirectoryProviders(providers: readonly DirectoryProvider[]): DirectoryProvider[] {
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((left, right) => {
      const rank = providerOrderRank(left.provider.id) - providerOrderRank(right.provider.id);
      if (rank !== 0) return rank;
      return left.index - right.index;
    })
    .map((entry) => entry.provider);
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

function captureProviderEntry(
  provider: typeof TELEGRAM_DIRECTORY_PROVIDER | typeof EMAIL_DIRECTORY_PROVIDER,
  input: {
    connected: boolean;
    attention: boolean;
  },
): DirectoryProvider {
  const status = input.connected
    ? providerRowStatus({ attention: input.attention, teamSyncing: false })
    : 'connected';
  return {
    id: provider.id,
    label: provider.label,
    description: provider.description,
    logo: provider.logo,
    kind: 'capture',
    available: true,
    connected: input.connected,
    status: input.connected ? status : 'connected',
    statusLabel: input.connected ? providerStatusLabel(status) : 'Not connected',
    primaryAction: input.connected ? 'open' : 'setup',
  };
}

function inboundEmailIsConfigured(settings: InboundEmailSettings | undefined): boolean {
  return Boolean(settings?.inboundEmail) && !settings?.placeholderInbound;
}

export function buildDirectoryProviders(input: {
  model: IntegrationsPageModel;
  slackConnections: number;
  telegramConnections: number;
  telegramWebhookConfigured?: boolean;
  inboundEmail?: InboundEmailSettings;
}): {
  email: DirectoryProvider;
  connected: DirectoryProvider[];
  available: DirectoryProvider[];
} {
  const connected: DirectoryProvider[] = [];
  const available: DirectoryProvider[] = [];
  const mcpByProvider = partitionMcpServers(
    input.model.mcpServerRows,
    input.model.nativeCatalog,
  ).byProviderId;
  for (const provider of input.model.nativeCatalog) {
    const providerRows = input.model.connectedRows.filter((row) => row.provider === provider.id);
    const owned = input.model.ownedConnections.filter((row) => row.provider === provider.id);
    const shares = input.model.teamSourceRows.filter(
      (row) => row.connection.provider === provider.id,
    );
    const slackCapture = provider.id === 'slack' && input.slackConnections > 0;
    // Keep MCP-only providers accessible: a custom MCP server named after a
    // native provider is routed into that provider's sheet, so the provider
    // must count as connected even with no native account or share.
    const matchingMcp = mcpByProvider.get(provider.id) ?? [];
    const mcpConnected = matchingMcp.length > 0;
    const isConnected =
      providerRows.length > 0 ||
      owned.length > 0 ||
      shares.length > 0 ||
      slackCapture ||
      mcpConnected;
    const attention =
      providerRows.some((row) => needsAttention(row)) ||
      owned.some((row) => Boolean(row.lastError)) ||
      matchingMcp.some((server) => Boolean(server.lastError));
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
      kind: 'native',
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

  const telegram = captureProviderEntry(TELEGRAM_DIRECTORY_PROVIDER, {
    connected: input.telegramConnections > 0,
    attention: input.telegramConnections > 0 && input.telegramWebhookConfigured === false,
  });
  if (telegram.connected) connected.push(telegram);
  else available.push(telegram);

  return {
    email: captureProviderEntry(EMAIL_DIRECTORY_PROVIDER, {
      connected: inboundEmailIsConfigured(input.inboundEmail),
      attention: Boolean(input.inboundEmail?.placeholderInbound),
    }),
    connected: sortDirectoryProviders(connected),
    available: sortDirectoryProviders(available),
  };
}

export function directoryProviderList(directory: {
  email: DirectoryProvider;
  connected: readonly DirectoryProvider[];
  available: readonly DirectoryProvider[];
}): DirectoryProvider[] {
  return [directory.email, ...directory.connected, ...directory.available];
}

const CONNECTIONS_TOOL_SHEETS = ['agent-mcp', 'timeline-mcp', 'webhooks'] as const;
export type ConnectionsToolSheet = (typeof CONNECTIONS_TOOL_SHEETS)[number];

const TOOL_SHEET_TAB: Record<ConnectionsToolSheet, ConnectionsTab> = {
  'agent-mcp': 'agent',
  'timeline-mcp': 'agent',
  webhooks: 'developer',
};

export function isConnectionsToolSheet(
  value: string | null | undefined,
): value is ConnectionsToolSheet {
  return CONNECTIONS_TOOL_SHEETS.some((sheet) => sheet === value);
}

function isQuietComingSoonMcp(entry: { status?: string }): boolean {
  return entry.status === 'coming_soon' || entry.status === 'mcp_local';
}

export function partitionAdvancedMcpCatalog<T extends { status?: string }>(
  entries: readonly T[],
): { connectable: T[]; comingSoon: T[] } {
  const connectable: T[] = [];
  const comingSoon: T[] = [];
  for (const entry of entries) {
    if (isQuietComingSoonMcp(entry)) comingSoon.push(entry);
    else connectable.push(entry);
  }
  return { connectable, comingSoon };
}

export function filterByDirectoryQuery<
  T extends { id: string; label: string; description?: string },
>(items: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) ||
      item.id.toLowerCase().includes(needle) ||
      (item.description?.toLowerCase().includes(needle) ?? false),
  );
}

export function filterAvailableProviders(
  providers: readonly DirectoryProvider[],
  query: string,
): DirectoryProvider[] {
  return filterByDirectoryQuery(providers, query);
}

export function directoryHashOwnerId(
  hash: string | null | undefined,
  providers: readonly { id: string }[],
): string | null {
  const value = hash?.replace(/^#/, '') ?? '';
  if (!value) return null;
  const exact = providers.find((provider) => provider.id === value);
  if (exact) return exact.id;
  const sectionOwners = providers.filter((provider) => value.startsWith(`${provider.id}-`));
  if (sectionOwners.length === 0) return null;
  return sectionOwners.reduce((longest, provider) =>
    provider.id.length >= longest.id.length ? provider : longest,
  ).id;
}

export function agentMcpAccessMatchesQuery(input: {
  query: string;
  connectable: readonly { id: string; label: string; description?: string }[];
  servers: readonly { id: string; name: string; url?: string | null }[];
}): boolean {
  const extras = [
    ...input.connectable,
    ...input.servers.map((server) => ({
      id: server.id,
      label: server.name,
      ...(server.url ? { description: server.url } : {}),
    })),
  ];
  return filterByDirectoryQuery(extras, input.query).length > 0;
}

export function initialOpenProviderId(input: {
  providers: readonly DirectoryProvider[];
  connectedRows: IntegrationsPageModel['connectedRows'];
  integrationId?: string;
  hash?: string;
}): string | null {
  const ownerId = directoryHashOwnerId(input.hash, input.providers);
  if (ownerId) return ownerId;
  if (!input.integrationId) return null;
  const row = input.connectedRows.find((item) => item.id === input.integrationId);
  return row?.provider ?? null;
}

/** Query-param sheet fallback is for the first navigation (and later popstate), not hash edits. */
export function connectionsIntegrationIdFallback(input: {
  source: 'initial' | 'hash' | 'popstate';
  dismissed: boolean;
  integrationId?: string;
}): string | undefined {
  if (input.dismissed || input.source === 'hash' || !input.integrationId) return undefined;
  return input.integrationId;
}

export function parseConnectionsLocation(input: {
  tab?: string | null;
  hash?: string | null;
  providers: readonly DirectoryProvider[];
  connectedRows: IntegrationsPageModel['connectedRows'];
  integrationId?: string;
}): { tab: ConnectionsTab; hash: string | null } {
  const hash = input.hash?.replace(/^#/, '') ?? '';
  if (isConnectionsToolSheet(hash)) {
    return { tab: TOOL_SHEET_TAB[hash], hash };
  }
  if (hash === 'audit' || hash === 'jobs') {
    return { tab: 'developer', hash };
  }
  if (directoryHashOwnerId(hash, input.providers)) {
    return { tab: 'sources', hash };
  }
  if (!hash && input.integrationId) {
    const fromId = initialOpenProviderId({
      providers: input.providers,
      connectedRows: input.connectedRows,
      integrationId: input.integrationId,
    });
    if (fromId) return { tab: 'sources', hash: fromId };
  }
  return { tab: connectionsTabFromSearch(input.tab), hash: hash || null };
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

export function openConnectionsPanel(event: MouseEvent<HTMLAnchorElement>, onOpen?: () => void) {
  if (
    !onOpen ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  onOpen();
}
