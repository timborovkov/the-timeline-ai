import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/legal-page', () => ({
  LegalPage: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

import TermsPage from '@/app/terms/page';

describe('Terms legal links', () => {
  it('links the browser-storage notice without treating acceptance as consent', () => {
    const html = renderToStaticMarkup(<TermsPage />);

    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('accepting these Terms does not consent');
  });
});
