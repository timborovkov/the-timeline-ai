import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/legal-page', () => ({
  LegalPage: ({
    children,
    description,
    title,
  }: {
    children: React.ReactNode;
    description: string;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </main>
  ),
}));

import PrivacyPage from '@/app/privacy/page';

describe('Privacy Policy analytics disclosures', () => {
  it('separates policy acknowledgement, public-browser consent, and personless counting', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Policy acknowledgement, account creation, and necessary storage');
    expect(html).toContain('does not run in protected workspace routes');
    expect(html).toContain('no PostHog browser event');
    expect(html).toContain('one non-visitor stream identifier');
    expect(html).toContain('cannot recognize a returning visitor or account');
    expect(html).toContain('Sentry error monitoring');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('href="/trust"');
  });

  it('discloses the fixed tracker source while keeping deployment evidence qualified', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('previous source version loaded a Convex-hosted page tracker');
    expect(html).toContain('current source removes that script');
    expect(html).toContain('historical data, and live production release still require');
    expect(html).toContain('Provider account settings');
    expect(html).toContain('do not use behavioral advertising trackers');
  });
});
