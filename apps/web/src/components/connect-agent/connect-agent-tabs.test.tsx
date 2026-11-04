import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import type React from 'react';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/image'),
  () => ({
    default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img {...props} alt={props.alt ?? ''} />
    ),
  }),
  () => import('next/image'),
);

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { ConnectAgentTabs } = await import('./connect-agent-tabs.js');

const MCP_URL = 'https://timeline.test/api/mcp/server';

afterEach(() => {
  cleanup();
});

describe('ConnectAgentTabs', () => {
  it('renders a client picker with official logos, copy actions, and the Cursor deeplink', () => {
    render(<ConnectAgentTabs mcpUrl={MCP_URL} teamEmail={null} />);

    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Agent clients' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toBeTruthy();

    const claudeCode = screen.getByRole('button', { name: 'Claude Code' });
    expect(claudeCode.closest('li')?.querySelector('img')?.getAttribute('src')).toBe(
      '/connectors/claude-code.svg',
    );
    expect(screen.getByRole('button', { name: 'Copy Claude Code commands' })).toBeTruthy();
    expect(screen.queryByText(/Developer Mode/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(screen.getByText(/Settings → Apps/)).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'ChatGPT' })
        .closest('li')
        ?.querySelector('img')
        ?.getAttribute('src'),
    ).toBe('/connectors/openai.svg');
    expect(screen.queryByText(/Developer Mode/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }));
    expect(
      screen
        .getByRole('button', { name: 'Cursor' })
        .closest('li')
        ?.querySelector('img')
        ?.getAttribute('src'),
    ).toBe('/connectors/cursor.svg');
    const deeplink = screen.getByRole('link', { name: 'Add to Cursor' });
    expect(deeplink.getAttribute('href') ?? '').toContain(
      'cursor://anysphere.cursor-deeplink/mcp/install',
    );
    expect(deeplink.getAttribute('href') ?? '').toContain('name=timeline');
  });
});
