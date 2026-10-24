// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  back: vi.fn(),
  reportCaughtError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

const { default: DocumentDetailLoading } = await import('./loading.js');
const { default: DocumentError } = await import('./error.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Document detail route states', () => {
  it('announces loading before a document-shaped responsive placeholder with one page heading', () => {
    const html = renderToStaticMarkup(<DocumentDetailLoading />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="sr-only">Document</h1>');
    expect(html).toContain('aria-live="polite"');
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf('aria-busy="true"'));
    expect(html).toContain('aria-label="Loading document"');
    expect(html).toContain('xl:grid-cols-[minmax(0,1fr)_18rem]');
    expect(html).toContain('max-sm:flex-col max-sm:items-stretch');
    expect(html).not.toContain('PageHeaderSkeleton');
  });

  it('keeps the Documents path and a keyboard-operable retry when document loading fails', async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<DocumentError error={new Error('offline')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Document' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Documents' }).getAttribute('href')).toBe(
      '/app/documents',
    );
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
    expect(
      screen.getByText(
        'Document details could not be loaded. Your saved document data is unchanged. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });
});
