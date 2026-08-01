// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import SlackError from '@/app/app/team/slack/error';
import SlackLoading from '@/app/app/team/slack/loading';
import TelegramError from '@/app/app/team/telegram/error';
import TelegramLoading from '@/app/app/team/telegram/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each([
  {
    label: 'Telegram',
    loadingLabel: 'Loading Telegram settings',
    subtitle: 'Route chat and voice notes into the same capture pipeline.',
    errorTitle: 'Unable to load Telegram settings',
    errorDescription:
      'Your Telegram links, group bindings, and captured messages have not changed. Check your connection, then try again.',
    Loading: TelegramLoading,
    Error: TelegramError,
  },
  {
    label: 'Slack',
    loadingLabel: 'Loading Slack settings',
    subtitle: 'Capture DMs, channel messages, slash-command answers, and linked sender context.',
    errorTitle: 'Unable to load Slack settings',
    errorDescription:
      'Your Slack workspace connection, channel bindings, and captured messages have not changed. Check your connection, then try again.',
    Loading: SlackLoading,
    Error: SlackError,
  },
])(
  '$label settings route states',
  ({
    label,
    loadingLabel,
    subtitle,
    errorTitle,
    errorDescription,
    Loading,
    Error: ErrorBoundary,
  }) => {
    it('announces loading outside the busy, route-shaped fallback and keeps visual skeletons out of the accessibility tree', () => {
      render(<Loading />);

      const announcement = screen.getByRole('status');
      expect(announcement.textContent).toBe(loadingLabel);
      expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
      expect(screen.getByLabelText(loadingLabel).getAttribute('aria-busy')).toBe('true');
      expect(screen.getAllByRole('heading', { level: 1, name: label })).toHaveLength(1);
      expect(screen.queryByRole('link', { name: 'Team settings' })).toBeNull();
      const skeleton = document.querySelector('[aria-busy="true"] > [aria-hidden="true"]');
      expect(skeleton).toBeTruthy();
      expect(skeleton?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    });

    it.each([
      { name: 'Enter', keys: '{Enter}' },
      { name: 'Space', keys: ' ' },
    ])('keeps context and lets keyboard users retry a failed load with $name', async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<ErrorBoundary error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: label })).toHaveLength(1);
      expect(screen.getByText(subtitle)).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2, name: errorTitle })).toBeTruthy();
      expect(screen.getByText(errorDescription)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Team settings' }).getAttribute('href')).toBe(
        '/app/team',
      );

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    });
  },
);
