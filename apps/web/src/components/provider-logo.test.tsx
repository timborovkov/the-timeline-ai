import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { ProviderLogo } from '@/components/provider-logo';
import { providerLogoSrc } from '@/lib/connections';

const { renderToStaticMarkup } = await import('react-dom/server');

describe('ProviderLogo', () => {
  it('maps native provider ids onto local connector assets', () => {
    expect(providerLogoSrc('github')).toBe('/connectors/github.svg');
    expect(providerLogoSrc('google_drive')).toBe('/connectors/google-drive.svg');
  });

  it('always sits the mark on a white padded tile', () => {
    const html = renderToStaticMarkup(<ProviderLogo src="/connectors/slack.svg" />);

    expect(html).toContain('bg-white');
    expect(html).toContain('rounded-sm');
    expect(html).toContain('p-1');
    expect(html).toContain('src="/connectors/slack.svg"');
    expect(html).not.toContain('/_next/image');
  });

  it('keeps local PNG marks off the image optimizer', () => {
    const html = renderToStaticMarkup(<ProviderLogo src="/connectors/hermes.png" />);

    expect(html).toContain('src="/connectors/hermes.png"');
    expect(html).not.toContain('/_next/image');
  });
});
