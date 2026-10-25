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
    expect(html).toContain('reviewed public page paths and referring website origins');
    expect(html).toContain('without query strings, fragments, page titles, or referrer paths');
  });

  it('discloses the fixed tracker source while keeping deployment evidence qualified', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('previous source version loaded a Convex-hosted page tracker');
    expect(html).toContain('current source removes that script');
    expect(html).toContain('historical data, and live production release still require');
    expect(html).toContain('Provider account settings');
    expect(html).toContain('do not use behavioral advertising trackers');
  });

  it('states access and infrastructure controls as policy pending deployment evidence', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('operating standard prohibits routine browsing');
    expect(html).toContain('Production access inventory');
    expect(html).toContain('hosted deployment design');
    expect(html).toContain('public exposure still require deployment');
  });

  it('discloses member-authorized MCP and AI-app data sharing', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Authorized-app data');
    expect(html).toContain('one selected team');
    expect(html).toContain('authorizing member&#x27;s private content');
    expect(html).toContain('content shared specifically with that member');
    expect(html).toContain('agent:ask');
    expect(html).toContain('external side effects');
    expect(html).toContain('own terms and privacy policy');
    expect(html).toContain('does not delete copies the app already received');
    expect(html).toContain('digests instead of plaintext');
    expect(html).toContain('records do not allow the app to regain access');
  });
});
