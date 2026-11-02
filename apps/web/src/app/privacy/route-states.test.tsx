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
const { default: PrivacyError } = await import('@/app/privacy/error');
const { default: TermsError } = await import('@/app/terms/error');
const { default: TrustError } = await import('@/app/trust/error');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const legalDocumentRoutes = [
  {
    errorDescription:
      'The cookies, browser storage, analytics, and related technologies used by The Timeline.',
    ErrorComponent: CookiesError,
    footerLabel: 'The Timeline legal',
    title: 'Cookies and similar technologies',
  },
  {
    errorDescription:
      'This policy explains how The Timeline processes personal data for team memory, capture, search, and AI-assisted workflows.',
    ErrorComponent: PrivacyError,
    footerLabel: 'The Timeline legal',
    title: 'Privacy Policy',
  },
  {
    errorDescription:
      'These terms govern access to The Timeline, a team memory product operated by Nyxone OÜ.',
    ErrorComponent: TermsError,
    footerLabel: 'The Timeline legal',
    title: 'Terms of Use',
  },
] as const;

describe('Legal route states', () => {
  it.each([
    ...legalDocumentRoutes,
    {
      errorDescription:
        'How The Timeline protects team data across AI inference, storage, permissions, meetings, analytics, and human access.',
      ErrorComponent: TrustError,
      footerLabel: 'The Timeline trust center',
      title: 'Trust, security, and data privacy',
    },
  ])(
    'preserves $title context and lets keyboard users retry an unexpected error',
    async ({ errorDescription, ErrorComponent, footerLabel, title }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<ErrorComponent error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      const heading = screen.getByRole('heading', { level: 1, name: title });
      expect(heading.className).toContain('text-3xl');
      expect(heading.className).toContain('sm:text-4xl');
      expect(screen.getByText(errorDescription)).toBeTruthy();
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
