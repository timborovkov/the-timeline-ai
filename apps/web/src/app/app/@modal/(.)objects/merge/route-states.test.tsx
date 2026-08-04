// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@/components/objects/object-merge-form', () => ({
  ObjectMergeForm: () => null,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <dialog open aria-label="Review merge">
      {children}
    </dialog>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div data-slot="dialog-content">{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const { default: MergeObjectModalError } = await import('./error.js');
const { default: MergeObjectModalLoading } = await import('./loading.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAlongsideBackground(content: ReactNode) {
  return renderToStaticMarkup(
    <main>
      <h1>Objects</h1>
      {content}
    </main>,
  );
}

describe('intercepted merge route states', () => {
  it('keeps its error inside the modal without adding a second page heading', async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    const html = renderAlongsideBackground(
      <MergeObjectModalError error={new Error('preview failed')} reset={reset} />,
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<dialog');
    expect(html).toContain('Unable to load merge preview');
    expect(html).toContain('No objects have been merged. Your saved object data is unchanged.');

    render(<MergeObjectModalError error={new Error('preview failed')} reset={reset} />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('keeps an inert, motion-safe loading state inside the modal without adding a second page heading', () => {
    const html = renderAlongsideBackground(<MergeObjectModalLoading />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Loading merge preview"');
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf('aria-busy="true"'));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain('motion-reduce:[&amp;_.animate-pulse]:animate-none');
    expect(html).toContain('sm:grid-cols-4');

    const { container } = render(<MergeObjectModalLoading />);
    const announcement = screen.getByRole('status');
    const loading = screen.getByLabelText('Loading merge preview');

    expect(announcement.textContent).toBe('Loading merge preview');
    expect(announcement.closest('dialog')).not.toBeNull();
    expect(announcement.closest('[data-slot="dialog-content"]')).not.toBeNull();
    expect(announcement.closest('[aria-busy="true"]')).toBeNull();
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.closest('[aria-hidden="true"]')).toBeNull();
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');

    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"][inert]',
    );
    expect(visualPlaceholders).toHaveLength(1);
    expect(visualPlaceholders[0]?.className).toContain('space-y-5');
    expect(
      visualPlaceholders[0]?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
  });
});
