import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { LegalPage } from '@/components/legal-page';
import { resetPublicSessionCache, setPublicSessionCache } from '@/lib/public-session';
// Test environment: happy-dom

const { cleanup, render, screen } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  resetPublicSessionCache();
});

describe('LegalPage', () => {
  it('keeps legal copy static while account actions stay pending on the server', () => {
    const html = renderToStaticMarkup(
      <LegalPage eyebrow="Version 1" title="Terms" description="Terms description">
        <p>Legal copy</p>
      </LegalPage>,
    );

    expect(html).toContain('Terms description');
    expect(html).toContain('Legal copy');
    expect(html).toContain('data-public-session="unknown"');
    expect(html).toContain('>Start free</a>');
  });

  it('offers signed-in visitors a route back to the app', () => {
    setPublicSessionCache({ status: 'signed-in' });
    render(
      <LegalPage eyebrow="Version 1" title="Terms" description="Terms description">
        <p>Legal copy</p>
      </LegalPage>,
    );

    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/app');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
