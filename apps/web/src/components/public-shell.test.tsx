import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PublicShell } from '@/components/public-shell';

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
    expect(html).not.toMatch(/href="(?:\/(?:app\/)?demo|\/workspace\/demo|https?:\/\/t\.me\/)/u);
  });

  it('keeps every public destination available in desktop, mobile, and footer navigation', () => {
    const html = renderToStaticMarkup(
      <PublicShell currentSection="integrations">
        <main id="main">Public content</main>
      </PublicShell>,
    );

    for (const href of ['/', '/integrations', '/pricing', '/how-it-works', '/help']) {
      expect(
        html.match(new RegExp(`href="${href.replace('/', '\\/')}"`, 'gu'))?.length,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(html).toContain('aria-label="Public navigation"');
    expect(html).toContain('aria-label="Public navigation menu"');
    expect(html).toContain('aria-label="Explore The Timeline"');
    expect(html.match(/aria-current="page"[^>]*href="\/integrations"/g)).toHaveLength(3);
    expect(html).toContain('<summary');
    expect(html).toContain('>Menu</span>');
  });

  it('uses the landing CTA state for signed-in public routes', () => {
    const html = renderToStaticMarkup(
      <PublicShell isSignedIn>
        <main id="main">Public content</main>
      </PublicShell>,
    );

    expect(html).toContain('href="/app"');
    expect(html).toContain('>Dashboard</a>');
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('>Open app</a>');
  });
});
