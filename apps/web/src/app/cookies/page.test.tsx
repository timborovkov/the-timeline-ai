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

import CookiesPage from '@/app/cookies/page';

describe('Cookies and similar technologies page', () => {
  it('publishes the current inventory without presenting notice as consent', () => {
    const html = renderToStaticMarkup(<CookiesPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Reading this notice alone does not accept analytics');
    expect(html).toContain('authjs.session-token');
    expect(html).toContain('30-day');
    expect(html).toContain('authjs.callback-url');
    expect(html).toContain('authjs.csrf-token');
    expect(html).toContain('authjs.pkce.code_verifier');
    expect(html).toContain('15-minute');
    expect(html).toContain('pending_invite');
    expect(html).toContain('tl_active_team');
    expect(html).toContain('up to 30 days');
    expect(html).toContain('timeline_sidebar_expanded');
    expect(html).toContain('timeline:floating-agent-chat:&lt;team&gt;:session');
    expect(html).toContain('no more than seven days');
    expect(html).toContain('timeline:chat-handoff:&lt;team&gt;');
    expect(html).toContain('up to 4,000 characters');
    expect(html).toContain('tl_analytics_consent');
    expect(html).toContain('tl_public_attribution');
    expect(html).toContain('ph_timeline_public_analytics_v1');
    expect(html).toContain('tl_posthog_consent_v1');
    expect(html).toContain('<strong>am_vid</strong>');
    expect(html).toContain('Current source no longer writes or sends these values');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/trust"');
  });

  it('documents the consent-gated browser boundary and separate surface requests', () => {
    const html = renderToStaticMarkup(<CookiesPage />);

    expect(html).toContain('after a separate affirmative choice');
    expect(html).toContain('zero PostHog browser events');
    expect(html).toContain('personless surface-request totals');
    expect(html).toContain('Bots and retries can contribute');
    expect(html).toContain('not visitor or session metrics');
    expect(html).toContain('Autocapture, heatmaps, session replay');
    expect(html).toContain('do not enable optional browser analytics yet');
    expect(html).toContain('Use Cookie settings to accept, reject, or withdraw');
  });

  it('keeps error monitoring and anti-abuse processing separate from analytics', () => {
    const html = renderToStaticMarkup(<CookiesPage />);

    expect(html).toContain('<strong>Sentry:</strong>');
    expect(html).toContain('separate from PostHog analytics');
    expect(html).toContain('<strong>Cloudflare Turnstile:</strong>');
    expect(html).toContain('Static repository documentation');
  });
});
