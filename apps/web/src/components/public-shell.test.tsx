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
  });
});
