export const CONNECTIONS_HREF = '/app/connections';
export const CONNECTIONS_LEGACY_HREF = '/app/sources';

export const CONNECTIONS_TABS = ['sources', 'agent', 'developer'] as const;
export type ConnectionsTab = (typeof CONNECTIONS_TABS)[number];

export const CONNECTIONS_TAB_PATH: Record<ConnectionsTab, string> = {
  sources: '/app/connections/sources',
  agent: '/app/connections/agent-tools',
  developer: '/app/connections/developer',
};

export function providerLogoSrc(provider: string): string {
  return `/connectors/${provider.replaceAll('_', '-')}.svg`;
}

export function connectionsTabFromSearch(tab?: string | null): ConnectionsTab {
  return tab === 'agent' || tab === 'developer' ? tab : 'sources';
}

export function connectionsTabFromPathname(pathname: string): ConnectionsTab {
  if (
    pathname === CONNECTIONS_TAB_PATH.agent ||
    pathname.startsWith(`${CONNECTIONS_TAB_PATH.agent}/`)
  ) {
    return 'agent';
  }
  if (
    pathname === CONNECTIONS_TAB_PATH.developer ||
    pathname.startsWith(`${CONNECTIONS_TAB_PATH.developer}/`)
  ) {
    return 'developer';
  }
  return 'sources';
}

export function connectionsTabHref(tab: ConnectionsTab, hash?: string | null): string {
  const path = CONNECTIONS_TAB_PATH[tab];
  const fragment = hash?.replace(/^#/, '') ?? '';
  return fragment ? `${path}#${fragment}` : path;
}

export interface ConnectionsSearchQuery {
  tab?: string | string[];
  connected?: string | string[];
  error?: string | string[];
  integrationId?: string | string[];
  reference?: string | string[];
}

function queryFromInput(query?: ConnectionsSearchQuery | URLSearchParams): URLSearchParams {
  const qs = query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams();
  if (!(query instanceof URLSearchParams) && query) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') qs.append(key, value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') qs.append(key, item);
        }
      }
    }
  }
  return qs;
}

export function connectionsHref(query?: ConnectionsSearchQuery | URLSearchParams): string {
  const qs = queryFromInput(query);
  const tab = connectionsTabFromSearch(qs.get('tab'));
  qs.delete('tab');
  const suffix = qs.toString();
  const path = CONNECTIONS_TAB_PATH[tab];
  return suffix ? `${path}?${suffix}` : path;
}

export function connectionsLegacyRedirectLocation(
  pathname: string,
  search?: ConnectionsSearchQuery | URLSearchParams,
): string | null {
  if (pathname === '/app/team/telegram') return connectionsTabHref('sources', 'telegram');
  if (
    pathname === CONNECTIONS_HREF ||
    pathname === CONNECTIONS_LEGACY_HREF ||
    pathname === '/app/team/integrations'
  ) {
    return connectionsHref(search);
  }
  return null;
}
