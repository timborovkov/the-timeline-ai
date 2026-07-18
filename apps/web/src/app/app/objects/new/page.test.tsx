import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/objects/new-object-form', () => ({
  NewObjectForm: () => <div data-testid="new-object-form" />,
}));
vi.mock('@/components/history-back-link', () => ({
  HistoryBackLink: ({ label }: { label: string }) => <a href="/app/objects">{label}</a>,
}));

const { default: NewObjectPage } = await import('./page.js');

describe('NewObjectPage', () => {
  it('keeps the Objects work navigation available', () => {
    const html = renderToStaticMarkup(<NewObjectPage />);

    expect(html).toContain('aria-label="Work"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/app\/objects"/);
  });
});
