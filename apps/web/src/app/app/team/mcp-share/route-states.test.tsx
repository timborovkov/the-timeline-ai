// @vitest-environment happy-dom

// Team admins need confidence that a failed MCP settings load has not changed
// bearer-key access, while assistive technology needs the route-specific context.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import McpShareError from '@/app/app/team/mcp-share/error';
import McpShareLoading from '@/app/app/team/mcp-share/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Timeline as MCP server route states', () => {
  it('announces a route-shaped loading state outside the busy placeholder', () => {
    render(<McpShareLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading Timeline as MCP server');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading Timeline as MCP server').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(
      screen.getAllByRole('heading', { level: 1, name: 'Timeline as MCP server' }),
    ).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe(
      '/app/team/integrations',
    );
    const loadingPlaceholder = screen.getByRole('region', {
      name: 'Timeline as MCP server loading placeholder',
    });
    expect(document.querySelectorAll('.md\\:grid-cols-4')).toHaveLength(1);
    expect(document.querySelectorAll('.xl\\:grid-cols-4')).toHaveLength(1);
    expect(document.querySelectorAll('.lg\\:grid-cols-3')).toHaveLength(1);
    expect(
      screen.getByTestId('mcp-endpoint-placeholder').querySelectorAll('.animate-pulse'),
    ).toHaveLength(9);
    expect(
      [...document.querySelectorAll('.animate-pulse')].every((element) =>
        Boolean(element.closest('[class*="motion-reduce"]')),
      ),
    ).toBe(true);
    const retrievalGrid = loadingPlaceholder.querySelector('.xl\\:grid-cols-4');
    const clientGuideGrid = loadingPlaceholder.querySelector('.lg\\:grid-cols-3');
    if (!retrievalGrid || !clientGuideGrid) throw new Error('Expected route-shaped loading grids.');
    expect(retrievalGrid.compareDocumentPosition(clientGuideGrid)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      clientGuideGrid.compareDocumentPosition(screen.getByTestId('active-keys-placeholder')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('preserves MCP key context and retries safely with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<McpShareError error={new Error('route failed')} reset={reset} />);

    expect(
      screen.getAllByRole('heading', { level: 1, name: 'Timeline as MCP server' }),
    ).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe(
      '/app/team/integrations',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load Timeline as MCP server' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This failed load did not change your MCP settings. If you just created or revoked a key, that change may already have succeeded. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
