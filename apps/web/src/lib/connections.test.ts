import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  CONNECTIONS_HREF,
  CONNECTIONS_TAB_PATH,
  connectionsHref,
  connectionsLegacyRedirectLocation,
  connectionsTabFromPathname,
  connectionsTabHref,
  providerLogoSrc,
} from '@/lib/connections';

describe('connectionsHref', () => {
  it('maps legacy tab query parameters onto Connections tab routes', () => {
    expect(connectionsHref()).toBe(CONNECTIONS_TAB_PATH.sources);
    expect(connectionsHref({ error: 'oauth_denied', connected: 'server-1' })).toBe(
      `${CONNECTIONS_TAB_PATH.sources}?error=oauth_denied&connected=server-1`,
    );
    expect(connectionsHref({ error: ['retry', 'ignored'] })).toBe(
      `${CONNECTIONS_TAB_PATH.sources}?error=retry&error=ignored`,
    );
    expect(connectionsHref({ tab: 'agent', connected: 'server-1' })).toBe(
      `${CONNECTIONS_TAB_PATH.agent}?connected=server-1`,
    );
    expect(connectionsHref({ tab: 'developer' })).toBe(CONNECTIONS_TAB_PATH.developer);
  });
});

describe('connections legacy HTTP redirects', () => {
  it('maps old Connections URLs onto tab routes without a fragment so browsers keep hashes', () => {
    expect(connectionsLegacyRedirectLocation('/app/connections')).toBe(
      CONNECTIONS_TAB_PATH.sources,
    );
    expect(connectionsLegacyRedirectLocation('/app/sources')).toBe(CONNECTIONS_TAB_PATH.sources);
    expect(
      connectionsLegacyRedirectLocation('/app/sources', new URLSearchParams('tab=developer')),
    ).toBe(CONNECTIONS_TAB_PATH.developer);
    expect(connectionsLegacyRedirectLocation('/app/team/integrations')).toBe(
      CONNECTIONS_TAB_PATH.sources,
    );
    expect(connectionsLegacyRedirectLocation('/app/team/telegram')).toBe(
      '/app/connections/sources#telegram',
    );
    expect(connectionsLegacyRedirectLocation('/app/connections/sources')).toBeNull();
  });
});

describe('connections tab routes', () => {
  it('keeps the Connections index, tab paths, and hashes aligned', () => {
    expect(CONNECTIONS_HREF).toBe('/app/connections');
    expect(connectionsTabFromPathname('/app/connections')).toBe('sources');
    expect(connectionsTabFromPathname('/app/connections/sources')).toBe('sources');
    expect(connectionsTabFromPathname('/app/connections/agent-tools')).toBe('agent');
    expect(connectionsTabFromPathname('/app/connections/developer')).toBe('developer');
    expect(connectionsTabHref('sources', 'telegram')).toBe('/app/connections/sources#telegram');
    expect(connectionsTabHref('agent', 'agent-mcp')).toBe('/app/connections/agent-tools#agent-mcp');
    expect(connectionsTabHref('developer', 'webhooks')).toBe('/app/connections/developer#webhooks');
  });
});

describe('providerLogoSrc', () => {
  it('maps native provider ids onto local connector assets', () => {
    expect(providerLogoSrc('github')).toBe('/connectors/github.svg');
    expect(providerLogoSrc('google_drive')).toBe('/connectors/google-drive.svg');
  });
});
