// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  back: vi.fn(),
  reportCaughtError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

const { default: CapturedDocumentsLoading } = await import('./loading.js');
const { default: CapturedDocumentsError } = await import('./error.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Captured files route states', () => {
  it('announces loading outside an inert, motion-safe captured-files placeholder', () => {
    const { container } = render(<CapturedDocumentsLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading captured files');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    const loading = screen.getByLabelText('Loading captured files');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Captured files' })).toHaveLength(1);
    expect(screen.queryByRole('list')).toBeNull();

    const visuals = container.querySelector('[aria-busy="true"] > [aria-hidden="true"][inert]');
    expect(visuals).toBeTruthy();
    expect(
      visuals?.querySelector('[aria-label="Captured files loading placeholder"]'),
    ).toBeTruthy();
    expect(visuals?.classList.contains('space-y-6')).toBe(true);
    expect(
      visuals?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
    expect(visuals?.querySelectorAll('.animate-pulse')).not.toHaveLength(0);
    for (const skeleton of visuals?.querySelectorAll('.animate-pulse') ?? []) {
      expect(skeleton.closest('[class*="motion-reduce"]')).toBeTruthy();
    }
    expect(visuals?.querySelector('[data-loading-toolbar="collection"]')).toBeTruthy();
    expect(visuals?.querySelector('.min-h-11')).toBeTruthy();
  });

  it('keeps the Documents path and a keyboard-operable retry when captured files fail to load', async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<CapturedDocumentsError error={new Error('offline')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Captured files' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Documents' }).getAttribute('href')).toBe(
      '/app/documents',
    );
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
    expect(
      screen.getByText(
        'Captured files could not be loaded. Your captured files have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });
});
