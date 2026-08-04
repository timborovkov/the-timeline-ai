// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import ChatError from '@/app/app/chat/error';
import AppError from '@/app/app/error';
import InboxError from '@/app/app/inbox/error';
import HomeLoading from '@/app/app/loading';
import TeamError from '@/app/app/team/error';
import SlackError from '@/app/app/team/slack/error';
import SlackLoading from '@/app/app/team/slack/loading';
import TelegramError from '@/app/app/team/telegram/error';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const ROUTE_ERRORS = [
  ['Home', AppError],
  ['Ask', ChatError],
  ['Inbox', InboxError],
  ['Team', TeamError],
  ['Slack', SlackError],
  ['Telegram', TelegramError],
] as const;

describe('authenticated route states', () => {
  it.each(ROUTE_ERRORS)('%s error retains exactly one page heading', (_, ErrorBoundary) => {
    const html = renderToStaticMarkup(
      <ErrorBoundary error={new Error('route failed')} reset={vi.fn()} />,
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('font-mono text-xs uppercase');
    expect(html).toContain('Try again');
  });

  it('preserves Home context without adding a visible dashboard heading to its error state', () => {
    const html = renderToStaticMarkup(
      <AppError error={new Error('route failed')} reset={vi.fn()} />,
    );

    expect(html).toContain('Unable to load Home');
    expect(html).toContain(
      'Your captured history and saved work are unchanged. Check your connection, then try again.',
    );
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it('retries the Home error with both Enter and Space', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<AppError error={new Error('route failed')} reset={reset} />);

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(reset).toHaveBeenCalledTimes(2);
  });
  it('server-renders the route-shaped Slack loading state', () => {
    const html = renderToStaticMarkup(<SlackLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading Slack settings"');
    expect(html).toContain('Loading Slack settings');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('href="/app/team"');
  });

  it('announces a row-shaped Home loading state outside the busy fallback', () => {
    render(<HomeLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading Home');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading Home').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Home' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Home loading placeholder' })).toBeTruthy();
  });
});
