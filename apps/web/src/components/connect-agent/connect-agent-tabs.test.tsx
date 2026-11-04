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
  it('renders agent guides with copy actions and the Cursor deeplink', () => {
    render(<ConnectAgentTabs mcpUrl={MCP_URL} />);

    expect(screen.getByRole('tablist', { name: 'Agent setup guides' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Claude Code' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Copy Claude Code commands' })).toBeTruthy();
    expect(screen.queryByText(/Developer Mode/)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'ChatGPT' }));
    expect(screen.getByText(/Settings → Apps/)).toBeTruthy();
    expect(screen.queryByText(/Developer Mode/)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Cursor' }));
    const deeplink = screen.getByRole('link', { name: 'Add to Cursor' });
    expect(deeplink.getAttribute('href') ?? '').toContain(
      'cursor://anysphere.cursor-deeplink/mcp/install',
    );
    expect(deeplink.getAttribute('href') ?? '').toContain('name=timeline');
  });
});
