import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
// Test environment: happy-dom

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
    expect(html).toContain('Your work should not become someone else');
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
    expect(html).toContain('Not claimed today');
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
  });

  it('routes signed-in readers back to their dashboard', () => {
    setPublicSessionCache({ status: 'signed-in' });
    render(<TrustPage />);

    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/app');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
