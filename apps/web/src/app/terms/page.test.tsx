import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/legal-page', () => ({
  LegalPage: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

import TermsPage from '@/app/terms/page';

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

    expect(html).toContain('publication-readiness review');
    expect(html).toContain('does not form an agreement');
    expect(html).not.toContain('These Terms of Use (“Terms”) are a binding agreement');
  });
});
