// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import DocumentsError from '@/app/app/documents/error';
import DocumentsLoading from '@/app/app/documents/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Documents route states', () => {
  it('announces a route-shaped loading state outside inert document browser visuals', () => {
    const { container } = render(<DocumentsLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading documents');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading documents').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Documents' })).toHaveLength(1);
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.querySelectorAll('.animate-pulse')).not.toHaveLength(0);
    for (const skeleton of document.querySelectorAll('.animate-pulse')) {
      expect(skeleton.closest('[class*="motion-reduce"]')).toBeTruthy();
    }
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    const visuals = container.querySelector('[aria-busy="true"] > [aria-hidden="true"][inert]');
    expect(visuals).toBeTruthy();
    expect(visuals?.classList.contains('space-y-6')).toBe(true);
    expect(
      visuals?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains Documents context, explains that saved data is unchanged, and retries with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<DocumentsError error={new Error('offline')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: 'Documents' })).toHaveLength(1);
      expect(screen.getByText('Browse files, folders, and captured knowledge.')).toBeTruthy();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Unable to load documents' }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Documents could not be loaded. Your files, folders, and captured knowledge are unchanged. Check your connection, then try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
