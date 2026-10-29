import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('@/components/theme-toggle'),
  () => ({
    ThemeToggle: () => <button type="button">Theme</button>,
  }),
  () => import('@/components/theme-toggle'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: vi.fn() }),
  () => import('@/lib/sentry-report'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: CookiesError } = await import('@/app/cookies/error');
const { default: CookiesLoading } = await import('@/app/cookies/loading');
const { default: PrivacyError } = await import('@/app/privacy/error');
const { default: PrivacyLoading } = await import('@/app/privacy/loading');
const { default: TermsError } = await import('@/app/terms/error');
const { default: TermsLoading } = await import('@/app/terms/loading');
const { default: TrustError } = await import('@/app/trust/error');
const { default: TrustLoading } = await import('@/app/trust/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const legalRoutes = [
  {
    description:
      'The cookies, browser storage, analytics, and related technologies used by The Timeline.',
    ErrorComponent: CookiesError,
    footerLabel: 'The Timeline legal',
    Loading: CookiesLoading,
    title: 'Cookies and similar technologies',
  },
  {
    description:
      'This policy explains how The Timeline processes personal data for team memory, capture, search, and AI-assisted workflows.',
    ErrorComponent: PrivacyError,
    footerLabel: 'The Timeline legal',
    Loading: PrivacyLoading,
    title: 'Privacy Policy',
  },
  {
    description:
      'These terms govern access to The Timeline, a team memory product operated by Nyxone OÜ.',
    ErrorComponent: TermsError,
    footerLabel: 'The Timeline legal',
    Loading: TermsLoading,
    title: 'Terms of Use',
  },
  {
    description:
      'How The Timeline protects team data across AI inference, storage, permissions, meetings, analytics, and human access.',
    ErrorComponent: TrustError,
    footerLabel: 'The Timeline trust center',
    Loading: TrustLoading,
    title: 'Trust, security, and data privacy',
  },
] as const;

describe('Legal route states', () => {
  it.each(legalRoutes)(
    'announces a $title loading state with legal context',
    ({ description, footerLabel, Loading, title }) => {
      render(<Loading />);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      const heading = screen.getByRole('heading', { level: 1, name: title });
      expect(heading.className).toContain('text-2xl');
      expect(heading.className).not.toContain('sm:text-4xl');
      expect(screen.getByText(description)).toBeTruthy();
      expect(screen.getByText(footerLabel)).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(`Loading ${title}`);
      expect(screen.getByLabelText(`${title} loading placeholder`).getAttribute('aria-busy')).toBe(
        'true',
      );
    },
  );

  it.each(legalRoutes)(
    'preserves $title context and lets keyboard users retry an unexpected error',
    async ({ description, ErrorComponent, footerLabel, title }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<ErrorComponent error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      const heading = screen.getByRole('heading', { level: 1, name: title });
      expect(heading.className).toContain('text-2xl');
      expect(heading.className).not.toContain('sm:text-4xl');
      expect(screen.getByText(description)).toBeTruthy();
      expect(screen.getByText(footerLabel)).toBeTruthy();
      expect(
        screen.getByRole('heading', { level: 2, name: `Unable to load ${title}` }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          `This error did not change the ${title} or your saved information. Check your connection, then try again.`,
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard('{Enter}');
      await user.keyboard('[Space]');

      expect(reset).toHaveBeenCalledTimes(2);
    },
  );
});
