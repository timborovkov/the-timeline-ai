import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import ChatError from '@/app/app/chat/error';
import AppError from '@/app/app/error';
import InboxError from '@/app/app/inbox/error';
import TeamError from '@/app/app/team/error';
import SlackError from '@/app/app/team/slack/error';
import SlackLoading from '@/app/app/team/slack/loading';
import TelegramError from '@/app/app/team/telegram/error';

const ROUTE_ERRORS = [
  ['app', AppError],
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

  it('uses the shared structured loading state for Slack', () => {
    const html = renderToStaticMarkup(<SlackLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading page"');
    expect(html).not.toContain('Loading Slack');
  });
});
