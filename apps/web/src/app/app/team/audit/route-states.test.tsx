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
  it('announces loading outside an inert, responsive audit skeleton', () => {
    const { container } = render(<AuditLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading trust audit');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading trust audit').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByLabelText('Loading trust audit').className).toContain(
      'motion-reduce:[&_.animate-pulse]:animate-none',
    );
    expect(screen.getAllByRole('heading', { level: 1, name: 'Trust audit' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/app/team');

    expect(screen.queryByRole('region')).toBeNull();
    const placeholder = container.querySelector('[aria-busy="true"] > [aria-hidden="true"][inert]');
    expect(placeholder).toBeTruthy();
    const rows = placeholder?.querySelectorAll('section > div');
    expect(rows).toHaveLength(5);
    const firstRow = rows?.item(0);
    expect(firstRow?.className).toContain('sm:grid-cols-[minmax(0,1fr)_minmax(10rem,18rem)]');
    const technicalDetailsPlaceholders =
      placeholder?.querySelectorAll('[data-loading-technical-details]') ?? [];
    expect(technicalDetailsPlaceholders).toHaveLength(5);
    for (const technicalDetailsPlaceholder of technicalDetailsPlaceholders) {
      expect(technicalDetailsPlaceholder.className).toContain('border-t');
      expect(technicalDetailsPlaceholder.className).toContain('pt-3');
      expect(technicalDetailsPlaceholder.className).toContain('sm:col-span-2');
    }
    expect(placeholder?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
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

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
