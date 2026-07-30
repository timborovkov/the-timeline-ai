// @vitest-environment happy-dom

// Personal MCP settings must keep their private boundary clear while loading
// or recovering so people can safely retry without assuming team settings changed.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PersonalMcpServersError from '@/app/app/me/mcp-servers/error';
import PersonalMcpServersLoading from '@/app/app/me/mcp-servers/loading';

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Personal MCP servers route states', () => {
  it('announces that personal MCP server settings are opening', () => {
    render(<PersonalMcpServersLoading />);

    expect(screen.getByLabelText('Opening personal MCP servers')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Opening personal MCP servers');
  });

  it('keeps private recovery copy and retry keyboard accessible', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(
      <PersonalMcpServersError
        error={Object.assign(new Error('Connection unavailable'), { digest: 'error-reference' })}
        reset={reset}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Personal MCP servers', level: 1 })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Unable to open personal MCP servers', level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your personal server settings have not changed. Check your connection and try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });
});
