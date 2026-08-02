// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));

import PrivacyError from '@/app/privacy/error';
import PrivacyLoading from '@/app/privacy/loading';
import TermsError from '@/app/terms/error';
import TermsLoading from '@/app/terms/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const legalRoutes = [
  {
    description:
      'This policy explains how The Timeline processes personal data for team memory, capture, search, and AI-assisted workflows.',
    ErrorComponent: PrivacyError,
    Loading: PrivacyLoading,
    title: 'Privacy Policy',
  },
  {
    description:
      'These terms govern access to The Timeline, a team memory product operated by Nyxone OÜ.',
    ErrorComponent: TermsError,
    Loading: TermsLoading,
    title: 'Terms of Use',
  },
] as const;

describe('Legal route states', () => {
  it.each(legalRoutes)(
    'announces a $title loading state with legal context',
    ({ description, Loading, title }) => {
      render(<Loading />);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      const heading = screen.getByRole('heading', { level: 1, name: title });
      expect(heading.className).toContain('text-2xl');
      expect(heading.className).not.toContain('sm:text-4xl');
      expect(screen.getByText(description)).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(`Loading ${title}`);
      expect(screen.getByLabelText(`${title} loading placeholder`).getAttribute('aria-busy')).toBe(
        'true',
      );
    },
  );

  it.each(legalRoutes)(
    'preserves $title context and lets keyboard users retry an unexpected error',
    async ({ description, ErrorComponent, title }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<ErrorComponent error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      const heading = screen.getByRole('heading', { level: 1, name: title });
      expect(heading.className).toContain('text-2xl');
      expect(heading.className).not.toContain('sm:text-4xl');
      expect(screen.getByText(description)).toBeTruthy();
      expect(
        screen.getByRole('heading', { level: 2, name: `Unable to load ${title}` }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          `This error did not change the ${title} or your saved information. Check your connection, then try again.`,
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard('{Enter}');
      await user.keyboard('[Space]');

      expect(reset).toHaveBeenCalledTimes(2);
    },
  );
});
