// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import AuditError from '@/app/app/team/audit/error';
import AuditLoading from '@/app/app/team/audit/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Trust audit route states', () => {
  it('announces a route-shaped loading state outside the busy audit list', () => {
    render(<AuditLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading trust audit');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading trust audit').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Trust audit' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/app/team');

    const placeholder = screen.getByRole('region', { name: 'Trust audit loading placeholder' });
    expect(placeholder.children).toHaveLength(5);
    expect(placeholder.firstElementChild?.className).toContain('sm:grid-cols-[1fr_auto]');
    const technicalDetailsPlaceholders = placeholder.querySelectorAll(
      '[data-loading-technical-details]',
    );
    expect(technicalDetailsPlaceholders).toHaveLength(5);
    for (const technicalDetailsPlaceholder of technicalDetailsPlaceholders) {
      expect(technicalDetailsPlaceholder.getAttribute('aria-hidden')).toBe('true');
      expect(technicalDetailsPlaceholder.className).toContain('border-t');
      expect(technicalDetailsPlaceholder.className).toContain('pt-3');
    }
    for (const skeleton of document.querySelectorAll('.animate-pulse')) {
      expect(skeleton.className).toContain('motion-reduce:animate-none');
    }
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains audit context, a safe retry message, and keyboard retry with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<AuditError error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: 'Trust audit' })).toHaveLength(1);
      expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/app/team');
      expect(
        screen.getByRole('heading', { level: 2, name: 'Unable to load trust audit' }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Your team’s audit history has not changed. Check your connection, then try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
