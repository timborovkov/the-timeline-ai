// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The top bar palette is the fastest path into search/navigation. These tests
 * cover the keyboard contract so command-like queries do not strand users on
 * the wrong route or open external links inside the app shell.
 */

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fakes.push }) }));

const { GlobalSearchPalette } = await import('./global-search-palette.js');

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        query: '',
        mode: 'preview',
        warnings: [],
        results: [],
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GlobalSearchPalette', () => {
  it('focuses the global input with Cmd+K', async () => {
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.keyboard('{Meta>}k{/Meta}');

    expect(screen.getByRole('searchbox', { name: 'Search or jump' })).toBe(document.activeElement);
  });

  it('opens the full search page when Enter is pressed without a selected result', async () => {
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('searchbox', { name: 'Search or jump' }));
    await user.keyboard('github{Enter}');

    expect(fakes.push).toHaveBeenCalledWith('/app/search?q=github');
  });

  it('opens the selected internal result with arrow keys and Enter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'boards',
          mode: 'preview',
          warnings: [],
          results: [
            {
              id: 'boards',
              kind: 'quick_link',
              title: 'Boards',
              snippet: 'Open boards.',
              href: '/app/boards',
              score: 2,
              scoreParts: { navigation: 1 },
              metadata: { group: 'Go to' },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('searchbox', { name: 'Search or jump' }));
    await user.keyboard('boards');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Boards/ })).toBeTruthy();
    });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(fakes.push).toHaveBeenCalledWith('/app/boards');
  });

  it('navigates keyboard selection in the same order results are rendered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'board',
          mode: 'preview',
          warnings: [],
          results: [
            {
              id: 'board:1',
              kind: 'board',
              title: 'Project board',
              snippet: 'A ranked work result returned first by the API.',
              href: '/app/boards/1',
              score: 4,
              scoreParts: { lexical: 1 },
              metadata: {},
            },
            {
              id: 'boards',
              kind: 'quick_link',
              title: 'Boards',
              snippet: 'The top visible result after grouping.',
              href: '/app/boards',
              score: 2,
              scoreParts: { navigation: 1 },
              metadata: { group: 'Go to' },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('searchbox', { name: 'Search or jump' }));
    await user.keyboard('board');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Project board/ })).toBeTruthy();
    });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(fakes.push).toHaveBeenCalledWith('/app/boards');
  });

  it('opens the all-results row when that row is selected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'boards',
          mode: 'preview',
          warnings: [],
          results: [
            {
              id: 'boards',
              kind: 'quick_link',
              title: 'Boards',
              snippet: 'Open boards.',
              href: '/app/boards',
              score: 2,
              scoreParts: { navigation: 1 },
              metadata: { group: 'Go to' },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('searchbox', { name: 'Search or jump' }));
    await user.keyboard('boards');
    await waitFor(() => {
      expect(screen.getByText(/Search all results for/)).toBeTruthy();
    });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(fakes.push).toHaveBeenCalledWith('/app/search?q=boards');
  });

  it('opens external results in a new tab', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'docs',
          mode: 'preview',
          warnings: [],
          results: [
            {
              id: 'help-docs',
              kind: 'external_link',
              title: 'Public help docs',
              snippet: 'Open public Timeline help in a new tab.',
              href: '/help',
              externalHref: '/help',
              score: 2,
              scoreParts: { navigation: 1 },
              metadata: { group: 'Docs' },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('searchbox', { name: 'Search or jump' }));
    await user.keyboard('docs');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Public help docs/ })).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: /Public help docs/ }));

    expect(open).toHaveBeenCalledWith('/help', '_blank', 'noopener,noreferrer');
  });

  it('renders friendly API errors instead of raw error codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ ok: false, error: 'rate_limited' }, { status: 429 })),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('searchbox', { name: 'Search or jump' }));
    await user.keyboard('github');

    expect(await screen.findByText(/Search is cooling down/)).toBeTruthy();
  });
});
