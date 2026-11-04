import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { citationAuthorHint, citationLogoSrc, citationSourceLabel } from '@/lib/citation-source';

describe('citationLogoSrc', () => {
  it('maps Slack, email, call, and Drive documents onto white-tile connector assets', () => {
    expect(citationLogoSrc({ kind: 'timeline_event', source: 'slack' })).toBe(
      '/connectors/slack.svg',
    );
    expect(citationLogoSrc({ kind: 'timeline_event', source: 'email' })).toBe(
      '/connectors/email.svg',
    );
    expect(
      citationLogoSrc({
        kind: 'timeline_event',
        source: 'meeting',
        metadata: { platform: 'zoom' },
      }),
    ).toBe('/connectors/zoom.svg');
    expect(
      citationLogoSrc({
        kind: 'timeline_event',
        source: 'meeting',
        metadata: { platform: 'meet' },
      }),
    ).toBe('/connectors/google-meet.svg');
    expect(
      citationLogoSrc({
        kind: 'document_chunk',
        source: 'document',
        metadata: { provider: 'google_drive' },
      }),
    ).toBe('/connectors/google-drive.svg');
  });

  it('leaves native documents without a Drive provider on the lucide fallback', () => {
    expect(citationLogoSrc({ kind: 'document_chunk', source: 'document' })).toBeNull();
  });

  it('names GitHub integration events from provider metadata', () => {
    expect(
      citationSourceLabel({
        kind: 'timeline_event',
        source: 'integration',
        metadata: { provider: 'github', github: { repo: 'acme-labs/atlas' } },
      }),
    ).toBe('GitHub');
    expect(citationAuthorHint({ provider: 'github', github: { repo: 'acme-labs/atlas' } })).toBe(
      'acme-labs/atlas',
    );
  });

  it('uses the integration provider mark when present', () => {
    expect(
      citationLogoSrc({
        kind: 'timeline_event',
        source: 'integration',
        metadata: { provider: 'github' },
      }),
    ).toBe('/connectors/github.svg');
  });
});
