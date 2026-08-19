// @vitest-environment happy-dom

// The MCP catalog is an operator recovery surface: filtering must keep its selected
// state and remaining connection options understandable without a pointer or sight.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpCatalog } from '@/components/integrations/mcp-catalog';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt="" />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: vi.fn(async ({ run }: { run: () => Promise<{ error?: string }> }) => run()),
  notifyError: vi.fn(),
}));

const entries = [
  {
    id: 'research',
    label: 'Research MCP',
    description: 'Search customer context.',
    logo: '/research.svg',
    category: 'Research',
    authType: 'none' as const,
    authHint: null,
    status: 'mcp_available',
    ingestStatus: 'available',
  },
  {
    id: 'code',
    label: 'Code MCP',
    description: 'Inspect repositories.',
    logo: '/code.svg',
    category: 'Engineering',
    authType: 'oauth' as const,
    authHint: null,
    status: 'mcp_available',
    ingestStatus: 'available',
  },
  {
    id: 'support',
    label: 'Support MCP',
    description: 'Review open requests.',
    logo: '/support.svg',
    category: 'Support',
    authType: 'bearer' as const,
    authHint: 'A support token is required.',
    status: 'mcp_available',
    ingestStatus: 'available',
  },
  {
    id: 'metrics',
    label: 'Metrics MCP',
    description: 'Check operational metrics.',
    logo: '/metrics.svg',
    category: 'Operations',
    authType: 'header' as const,
    authHint: 'An API header is required.',
    status: 'mcp_available',
    ingestStatus: 'available',
  },
];

afterEach(cleanup);

describe('McpCatalog', () => {
  it('does not offer hosted connection for a local desktop MCP server', () => {
    render(
      <McpCatalog
        entries={[
          {
            id: 'figma',
            label: 'Figma',
            description: 'Local desktop design context.',
            logo: '/figma.svg',
            category: 'Design',
            authType: 'none',
            authHint: 'Run Figma locally.',
            status: 'mcp_local',
            ingestStatus: 'coming_soon',
          },
        ]}
      />,
    );

    expect(screen.getByText('Local desktop only')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Local setup only' }).disabled,
    ).toBe(true);
    expect(screen.queryByText('Run Figma locally.')).toBeNull();
  });

  it('enables a local desktop MCP server in an explicit local environment', () => {
    render(
      <McpCatalog
        localConnectionsEnabled
        entries={[
          {
            id: 'figma',
            label: 'Figma',
            description: 'Local desktop design context.',
            logo: '/figma.svg',
            category: 'Design',
            authType: 'none',
            authHint: 'Run Figma locally.',
            status: 'mcp_local',
            ingestStatus: 'coming_soon',
          },
        ]}
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Connect' }).disabled).toBe(false);
    expect(screen.getByText('Run Figma locally.')).toBeTruthy();
  });

  it('exposes category selection and the remaining catalog count to keyboard and assistive-technology users', async () => {
    const user = userEvent.setup();

    render(<McpCatalog entries={entries} />);

    const engineering = screen.getByRole('button', { name: 'Engineering' });
    expect(engineering.getAttribute('aria-pressed')).toBe('false');
    expect(engineering.className).toContain('min-h-9');
    expect(engineering.className).toContain('forced-colors:focus-visible:outline');
    expect(screen.getByRole('searchbox', { name: 'Filter MCP servers' }).className).toContain(
      'h-9',
    );
    expect(screen.getByRole('status').textContent).toBe('4 of 4 MCP servers');

    engineering.focus();
    await user.keyboard('{Enter}');

    expect(engineering.getAttribute('aria-pressed')).toBe('true');
    expect(engineering.className).toContain('forced-colors:focus-visible:outline-2');
    expect(screen.getByRole('status').textContent).toBe('1 of 4 MCP servers');
    expect(screen.getByText('Code MCP')).toBeTruthy();
    expect(screen.queryByText('Research MCP')).toBeNull();
  });

  it('provides a reachable recovery action after a filter hides every server', async () => {
    const user = userEvent.setup();

    render(<McpCatalog entries={entries} />);

    await user.type(screen.getByRole('searchbox', { name: 'Filter MCP servers' }), 'missing');

    expect(screen.getByText('0 of 4 MCP servers')).toBeTruthy();
    expect(screen.getByText('No MCP servers match this filter')).toBeTruthy();

    const clearFilters = screen.getByRole('button', { name: 'Clear filters' });
    expect(clearFilters.className).toContain('min-h-9');
    expect(clearFilters.className).toContain('forced-colors:focus-visible:outline');

    await user.click(clearFilters);

    expect(screen.getByRole('status').textContent).toBe('4 of 4 MCP servers');
    expect(screen.getByText('Research MCP')).toBeTruthy();
  });

  it('keeps missing bearer tokens on the field', async () => {
    const user = userEvent.setup();
    render(<McpCatalog entries={entries.filter((entry) => entry.id === 'support')} />);

    await user.click(screen.getByRole('button', { name: 'Connect with token' }));
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(screen.getByRole('alert').textContent).toBe('Enter a bearer token.');
  });
});
