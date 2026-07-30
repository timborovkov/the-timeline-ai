// @vitest-environment happy-dom

// Legacy Team MCP bookmarks must continue to reach Integrations, while their
// transition and recovery states tell people where their settings live.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import McpServersError from '@/app/app/team/mcp-servers/error';
import McpServersLoading from '@/app/app/team/mcp-servers/loading';
import McpServersRedirect from '@/app/app/team/mcp-servers/page';

const fakes = vi.hoisted(() => ({ redirect: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Team MCP servers route states', () => {
  it('announces that the legacy route is opening the team MCP settings', () => {
    render(<McpServersLoading />);

    expect(screen.getByLabelText('Opening team MCP server settings')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Opening team MCP server settings');
  });

  it('keeps recovery copy and retry keyboard accessible if the redirect cannot complete', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(
      <McpServersError
        error={Object.assign(new Error('Connection unavailable'), { digest: 'error-reference' })}
        reset={reset}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Team MCP servers', level: 1 })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Unable to open team MCP servers', level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'MCP server settings are managed in Integrations. Your settings have not changed. Try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('keeps legacy callback query parameters when opening Integrations', async () => {
    await McpServersRedirect({
      searchParams: Promise.resolve({ connected: 'server-1', error: ['retry', 'ignored'] }),
    });

    expect(fakes.redirect).toHaveBeenCalledWith(
      '/app/team/integrations?connected=server-1&error=retry',
    );
  });
});
