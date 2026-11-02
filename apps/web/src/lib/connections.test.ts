import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { CONNECTIONS_HREF, connectionsHref, providerLogoSrc } from '@/lib/connections';

describe('connectionsHref', () => {
  it('returns the Connections path and preserves query parameters', () => {
    expect(connectionsHref()).toBe(CONNECTIONS_HREF);
    expect(connectionsHref({ error: 'oauth_denied', connected: 'server-1' })).toBe(
      `${CONNECTIONS_HREF}?error=oauth_denied&connected=server-1`,
    );
    expect(connectionsHref({ error: ['retry', 'ignored'] })).toBe(
      `${CONNECTIONS_HREF}?error=retry&error=ignored`,
    );
  });
});

describe('providerLogoSrc', () => {
  it('maps native provider ids onto local connector assets', () => {
    expect(providerLogoSrc('github')).toBe('/connectors/github.svg');
    expect(providerLogoSrc('google_drive')).toBe('/connectors/google-drive.svg');
  });
});
