import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PublicShell } from '@/components/public-shell';
import { resetPublicSessionCache, setPublicSessionCache } from '@/lib/public-session';
// Test environment: happy-dom

const { cleanup, render, screen } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  resetPublicSessionCache();
});

// Public pages must let keyboard users bypass shared navigation before any other action.
describe('PublicShell', () => {
  it('renders the skip link first and targets the page main landmark', () => {
    const html = renderToStaticMarkup(
      <PublicShell>
        <main id="main">Public content</main>
      </PublicShell>,
    );

    expect(html.indexOf('href="#main"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf('href="/"'));
    expect(html).toContain('<main id="main">Public content</main>');
    expect(html).toContain('min-h-dvh');
    expect(html).toContain('data-public-header="true"');
    expect(html).toContain('href="https://github.com/timborovkov/the-timeline-ai"');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    expect(html).not.toContain('>Source on GitHub<');
    expect(html).toContain('href="/sign-in"');
    expect(html.match(/href="\/sign-in"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Toggle theme"/g)).toHaveLength(2);
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain('>Start free</a>');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('data-public-analytics-cta="try_project"');
    expect(html).toContain('data-public-analytics-cta="sign_in"');
    expect(html).toContain('data-public-session="unknown"');
    expect(html).not.toMatch(/href="(?:\/(?:app\/)?demo|\/workspace\/demo|https?:\/\/t\.me\/)/u);
  });

  it('keeps every public destination available in desktop, mobile, and footer navigation', () => {
    const html = renderToStaticMarkup(
      <PublicShell currentSection="agents">
        <main id="main">Public content</main>
      </PublicShell>,
    );

    for (const href of [
      '/',
      '/use-cases',
      '/integrations',
      '/agents',
      '/pricing',
      '/product-tour',
    ]) {
      expect(
        html.match(new RegExp(`href="${href.replace('/', '\\/')}"`, 'gu'))?.length,
      ).toBeGreaterThanOrEqual(3);
    }
    for (const href of ['/compare', '/how-it-works', '/help']) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain('aria-label="Public navigation"');
    expect(html).toContain('aria-label="Public navigation menu"');
    expect(html).toContain('aria-label="Explore The Timeline"');
    expect(html).toContain('aria-label="Product"');
    expect(html).toContain('aria-label="Use cases"');
    expect(html).toContain('aria-label="Integrations"');
    expect(html).toContain('aria-label="Compare"');
    expect(html).toContain('aria-label="Support and legal"');
    expect(html.match(/aria-current="page"[^>]*href="\/agents"/g)).toHaveLength(3);
    expect(html).toContain('<summary');
    expect(html).toContain('>Menu</span>');
    expect(html).toContain('Slack');
    expect(html).toContain('Telegram');
    expect(html).toContain('Google Drive');
    expect(html).toContain('GitHub');
    expect(html).toContain('Linear');
    expect(html).toContain('Monday.com');
    expect(html).toContain('Sentry');
    expect(html).toContain('Connect MCP tools');
    expect(html).toContain('href="/integrations/mcp"');
    expect(html).toContain('href="/integrations/sentry"');
    expect(html).not.toContain('Native sync');
    expect(html).not.toContain('MCP lookup');
    expect(html).not.toContain('Slack ·');
    expect(html).not.toContain('href="/integrations/jira"');
    expect(html).not.toContain('href="/integrations/notion"');
    expect(html).toContain('The Timeline vs Day AI');
    expect(html).not.toContain('HubSpot · Coming soon');
    expect(html).not.toContain('Attio · Coming soon');
    expect(html).not.toContain('Pipedrive · Coming soon');
    expect(html).not.toContain('Works with HubSpot');
  });

  it('marks the Trust legal link as the current page', () => {
    const html = renderToStaticMarkup(
      <PublicShell currentSection="trust">
        <main id="main">Trust</main>
      </PublicShell>,
    );

    expect(html).toMatch(/<a(?=[^>]*href="\/trust")(?=[^>]*aria-current="page")[^>]*>/);
  });

  it('uses the landing CTA state for signed-in public routes', () => {
    setPublicSessionCache({ status: 'signed-in' });
    render(
      <PublicShell>
        <main id="main">Public content</main>
      </PublicShell>,
    );

    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/app');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start free' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open app' })).toBeNull();
  });

  it('can omit account actions from auth-neutral loading and error chrome', () => {
    const html = renderToStaticMarkup(
      <PublicShell showAccountActions={false}>
        <main id="main">Public content</main>
      </PublicShell>,
    );

    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('href="/sign-up"');
    expect(html).not.toContain('>Start free</a>');
    expect(html).not.toContain('>Dashboard</a>');
    expect(html).toContain('data-public-header="true"');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    expect(html.match(/aria-label="Toggle theme"/g)).toHaveLength(2);
  });
});
