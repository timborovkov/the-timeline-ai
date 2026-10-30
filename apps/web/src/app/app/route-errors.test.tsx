import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ back: vi.fn() }),
  }),
  () => import('next/navigation'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: ChatError } = await import('@/app/app/chat/error');
const { default: AppError } = await import('@/app/app/error');
const { default: InboxError } = await import('@/app/app/inbox/error');
const { default: HomeLoading } = await import('@/app/app/loading');
const { default: TeamError } = await import('@/app/app/team/error');
const { default: SlackError } = await import('@/app/app/team/slack/error');
const { default: SlackLoading } = await import('@/app/app/team/slack/loading');
const { default: TelegramError } = await import('@/app/app/team/telegram/error');

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
    expect(html).toContain('Retry</button>');
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

    const retry = screen.getByRole('button', { name: 'Retry' });
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
