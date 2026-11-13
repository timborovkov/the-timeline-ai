import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => '/trust',
  }),
  () => import('next/navigation'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { resetPublicSessionCache, setPublicSessionCache } = await import('@/lib/public-session');
const { default: TrustPage } = await import('@/app/trust/page');

afterEach(() => {
  cleanup();
  resetPublicSessionCache();
});

describe('Trust page', () => {
  it('states the enforceable AI boundary and current assurance status', () => {
    const html = renderToStaticMarkup(<TrustPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Trust, security &amp; data privacy.');
    expect(html).toContain('ZDR by role');
    expect(html).toContain('Prohibited by policy');
    expect(html).not.toContain('evidence remains pending');
    expect(html).toContain('ZDR-required roles reject endpoints with weaker retention terms');
    expect(html).toContain('data_collection: deny');
    expect(html).toContain('zdr: true');
    expect(html).toContain('cache-disable control');
    expect(html).toContain('openai/gpt-4o-transcribe');
    expect(html).toContain('Retained transcription; no training');
    expect(html).toContain('up to 30 days');
    expect(html).toContain('SOC 2 report, ISO 27001 certification');
    expect(html).toContain('Browser analytics is confined to');
    expect(html).toContain('protected workspace');
    expect(html).toContain('Personless surface streams');
    expect(html).toContain('team authorization and short-lived signed URLs');
    expect(html).toContain('staff access policy prohibits routine browsing');
    expect(html).toContain('1 hour requested');
    expect(html).toContain('not independently verify provider-account settings');
    expect(html).toContain('Legal documents');
    expect(html).toContain('aria-labelledby="trust-legal-heading"');
    expect(html).toMatch(/<a(?=[^>]*href="\/trust")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).not.toMatch(
      /evidence pending|deployment checklist|release gate|quality gate|badges we have not earned/,
    );
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="https://github.com/timborovkov/the-timeline-ai"');
    expect(html).toContain('Firecrawl');
    expect(html).toContain('public pages of a website URL submitted during first-run onboarding');
    expect(html).toContain('What Timeline preserves');
    expect(html).toContain('human review instead of applying it on its own');
    expect(html).toContain('Kept as received');
    expect(html).toContain('Placed on one chronology');
  });

  it('provides direct topic links to focusable sections and keeps assurance upfront', () => {
    render(<TrustPage />);
    const navigation = screen.getByRole('navigation', { name: 'Trust topics' });
    const links = navigation.querySelectorAll('a');
    expect(links).toHaveLength(6);
    for (const link of links) {
      const href = link.getAttribute('href');
      expect(href).toBeTruthy();
      const section = href ? document.getElementById(href.slice(1)) : null;
      expect(section?.tagName).toBe('SECTION');
      expect(section?.getAttribute('tabindex')).toBe('-1');
    }
    const intro = screen.getByRole('heading', { level: 1 }).closest('section');
    expect(intro?.textContent).toContain('does not currently claim a SOC 2 report');
  });

  it('keeps policy details in the DOM and collapsed by default', () => {
    render(<TrustPage />);
    const disclosure = screen
      .getByText('Read the staff access and deletion policy')
      .closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.textContent).toContain('30 minutes');
  });

  it('routes signed-in readers back to their dashboard', () => {
    setPublicSessionCache({ status: 'signed-in' });
    render(<TrustPage />);

    for (const link of screen.getAllByRole('link', { name: 'Dashboard' })) {
      expect(link.getAttribute('href')).toBe('/app');
    }
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
