import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

/**
 * The top bar palette is the fastest path into search/navigation. These tests
 * cover the keyboard contract so command-like queries do not strand users on
 * the wrong route or open external links inside the app shell.
 */

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ push: fakes.push }),
  }),
  () => import('next/navigation'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

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

    expect(screen.getByRole('combobox', { name: 'Search or jump' })).toBe(document.activeElement);
  });

  it('opens the full search page when Enter is pressed without a selected result', async () => {
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
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

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
    await user.keyboard('boards');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Boards/ })).toBeTruthy();
    });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(fakes.push).toHaveBeenCalledWith('/app/boards');
  });

  it('shows exact due metadata on compact task results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'review',
          mode: 'preview',
          warnings: [],
          results: [
            {
              id: 'task:1',
              kind: 'task',
              title: 'Review launch',
              snippet: 'todo · launch',
              href: '/app/objects/1',
              score: 2,
              scoreParts: { lexical: 1 },
              metadata: { type: 'task', status: 'todo', dueAt: '2099-07-04T00:00:00.000Z' },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
    await user.keyboard('review');

    expect(await screen.findByText('Due Jul 4, 2099')).toBeTruthy();
    expect(screen.getByText('todo · launch')).toBeTruthy();
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

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
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

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
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

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
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

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
    await user.keyboard('github');

    expect(await screen.findByText(/Search is cooling down/)).toBeTruthy();
  });

  it('keeps preview results and shows source warnings when semantic recovery is exhausted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'github',
          mode: 'preview',
          warnings: [
            { source: 'timeline_event', message: 'Timeline search is temporarily unavailable.' },
          ],
          results: [
            {
              id: 'github-integration',
              kind: 'object',
              title: 'GitHub integration',
              snippet: 'Migrate the GitHub connector.',
              href: '/app/objects/github-integration',
              score: 2,
              scoreParts: { lexical: 1 },
              metadata: { type: 'project' },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
    await user.keyboard('github');

    expect(await screen.findByRole('button', { name: /GitHub integration/ })).toBeTruthy();
    expect(screen.getByText(/Timeline search is temporarily unavailable/)).toBeTruthy();
    expect(screen.queryByText('No matches.')).toBeNull();
  });

  it('does not say no matches when preview search only returns source warnings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'launch',
          mode: 'preview',
          warnings: [
            { source: 'document_chunk', message: 'Document search is temporarily unavailable.' },
          ],
          results: [],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<GlobalSearchPalette />);

    await user.click(screen.getByRole('combobox', { name: 'Search or jump' }));
    await user.keyboard('launch');

    expect(await screen.findByText('Document search is temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByText('No matches.')).toBeNull();
  });
});

it('keeps an empty search selection attached to a rendered row', async () => {
  const user = userEvent.setup();
  render(<GlobalSearchPalette />);
  const input = screen.getByRole('combobox', { name: 'Search or jump' });
  await user.type(input, 'no-matches');
  await screen.findByText('No matches.');
  await user.keyboard('{ArrowDown}');
  const active = input.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  expect(document.getElementById(active ?? '')?.textContent).toContain('Search all results');
  await user.keyboard('{Enter}');
  expect(fakes.push).toHaveBeenCalledWith('/app/search?q=no-matches');
});
