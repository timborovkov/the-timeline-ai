import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
await vi.mock(
  import.meta.resolve('@/components/legal-page'),
  () => ({
    LegalPage: ({ children, title }: { children: React.ReactNode; title: string }) => (
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    ),
  }),
  () => import('@/components/legal-page'),
);

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: TermsPage } = await import('@/app/terms/page');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Terms legal links', () => {
  it('links the browser-storage notice without treating acceptance as consent', () => {
    const html = renderToStaticMarkup(<TermsPage />);

    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('accepting these Terms does not consent');
  });

  it('withholds the binding agreement while production publication is blocked', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEGAL_PUBLICATION_READY', 'false');

    const html = renderToStaticMarkup(<TermsPage />);

    expect(html).toContain('until publication is enabled');
    expect(html).toContain('New account creation is paused');
    expect(html).toContain('does not form an agreement');
    expect(html).not.toContain('These Terms of Use (“Terms”) are a binding agreement');
  });

  it('does not prerender the publication gate', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
      'utf8',
    );
    expect(source).toContain("export const dynamic = 'force-dynamic'");
  });
});
