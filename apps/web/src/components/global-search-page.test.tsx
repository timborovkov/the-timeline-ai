// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The full search page is the durable fallback when palette preview is not
 * enough. These tests cover the request contract, visible warnings, and link
 * rendering that users rely on for deeper search sessions.
 */

const fakes = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: fakes.replace }) }));

const { GlobalSearchPage } = await import('./global-search-page.js');

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function inputValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) {
    return element.value;
  }
  throw new Error('Expected an input element.');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        query: 'launch',
        mode: 'full',
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

describe('GlobalSearchPage', () => {
  it('applies result type filters to the global search request', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);

    render(<GlobalSearchPage initialQuery="launch" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await user.click(screen.getByRole('button', { name: 'Result types' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Documents' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Tasks' }));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      const init = lastCall?.[1];
      expect(init?.body).toContain('"kinds":["document_chunk","task"]');
    });
  });

  it('submits a new query and updates the URL', async () => {
    const user = userEvent.setup();

    render(<GlobalSearchPage initialQuery="launch" />);

    await user.clear(screen.getByRole('searchbox', { name: 'Search everything' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search everything' }), 'github docs');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(fakes.replace).toHaveBeenCalledWith('/app/search?q=github+docs');
    });
  });

  it('keeps applied filters in the shareable search URL', async () => {
    const user = userEvent.setup();

    render(<GlobalSearchPage initialQuery="launch" />);

    await user.click(screen.getByRole('button', { name: 'Result types' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Documents' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Source' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Slack' }));
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText('From'), '2026-06-01');
    await user.type(screen.getByLabelText('To'), '2026-06-30');

    await waitFor(() => {
      expect(fakes.replace).toHaveBeenCalledWith(
        '/app/search?q=launch&type=documents&source=slack&from=2026-06-01&to=2026-06-30',
      );
    });
  });

  it('sends source and date filters to global search', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);

    render(<GlobalSearchPage initialQuery="launch" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await user.click(screen.getByRole('button', { name: 'Source' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Slack' }));
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText('From'), '2026-06-01');
    await user.type(screen.getByLabelText('To'), '2026-06-30');

    await waitFor(() => {
      const lastBody = fetchMock.mock.calls.at(-1)?.[1]?.body;
      expect(typeof lastBody).toBe('string');
      const parsed = JSON.parse(lastBody as string) as {
        source?: string[];
        from?: string;
        to?: string;
      };
      expect(parsed.source).toEqual(['slack']);
      expect(parsed.from).toBe('2026-06-01T00:00:00.000Z');
      expect(parsed.to).toBe('2026-07-01T00:00:00.000Z');
    });
  });

  it('keeps ingest webhook as a selectable source filter', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);

    render(<GlobalSearchPage initialQuery="launch" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await user.click(screen.getByRole('button', { name: 'Source' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Ingest webhook' }));

    await waitFor(() => {
      const lastBody = fetchMock.mock.calls.at(-1)?.[1]?.body;
      expect(typeof lastBody).toBe('string');
      const parsed = JSON.parse(lastBody as string) as { source?: string[] };
      expect(parsed.source).toEqual(['ingest_webhook']);
    });
  });

  it('initializes source and date filters from URL props', async () => {
    const fetchMock = vi.mocked(fetch);

    render(
      <GlobalSearchPage
        initialQuery="launch"
        initialType="documents"
        initialSource="slack"
        initialFrom="2026-06-01"
        initialTo="2026-06-30"
      />,
    );

    await waitFor(() => {
      const lastBody = fetchMock.mock.calls.at(-1)?.[1]?.body;
      expect(typeof lastBody).toBe('string');
      const parsed = JSON.parse(lastBody as string) as {
        query?: string;
        source?: string[];
        from?: string;
        to?: string;
      };
      expect(parsed.query).toBe('launch');
      expect(parsed.source).toEqual(['slack']);
      expect(parsed.from).toBe('2026-06-01T00:00:00.000Z');
      expect(parsed.to).toBe('2026-07-01T00:00:00.000Z');
    });
    expect(screen.getByRole('button', { name: 'Source' }).textContent).toContain('Slack');
    expect(inputValue(screen.getByLabelText('From'))).toBe('2026-06-01');
    expect(inputValue(screen.getByLabelText('To'))).toBe('2026-06-30');
    expect(screen.getByRole('button', { name: 'Result types' }).textContent).toContain('Documents');
  });

  it('syncs the search query when URL props change', async () => {
    const fetchMock = vi.mocked(fetch);
    const { rerender } = render(<GlobalSearchPage initialQuery="launch" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    fetchMock.mockClear();

    rerender(<GlobalSearchPage initialQuery="github docs" />);

    await waitFor(() => {
      const lastBody = fetchMock.mock.calls.at(-1)?.[1]?.body;
      expect(typeof lastBody).toBe('string');
      const parsed = JSON.parse(lastBody as string) as { query?: string };
      expect(parsed.query).toBe('github docs');
    });
    expect(inputValue(screen.getByRole('searchbox', { name: 'Search everything' }))).toBe(
      'github docs',
    );
  });

  it('renders warnings and internal/external result links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          query: 'docs',
          mode: 'full',
          warnings: [{ source: 'semantic', message: 'Semantic search is not configured.' }],
          results: [
            {
              id: 'objects',
              kind: 'quick_link',
              title: 'Objects',
              snippet: 'Browse objects.',
              href: '/app/objects',
              score: 2,
              scoreParts: { navigation: 1 },
              metadata: {
                group: 'Go to',
                relatedEvidence: 'Acme renewal',
                relatedEvidenceSignals: 3,
                relatedEvidenceStatusSources: 1,
              },
            },
            {
              id: 'help-docs',
              kind: 'external_link',
              title: 'Public help docs',
              snippet: 'Open help.',
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

    render(<GlobalSearchPage initialQuery="docs" />);

    expect(await screen.findByText('Semantic search is not configured.')).toBeTruthy();
    expect(
      screen.getByText(/Related evidence · Acme renewal · 3 signals · 1 status source/i),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /Objects/ }).getAttribute('href')).toBe('/app/objects');
    const external = screen.getByRole('link', { name: /Public help docs/ });
    expect(external.getAttribute('href')).toBe('/help');
    expect(external.getAttribute('target')).toBe('_blank');
  });

  it('renders API errors as user-visible empty states', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ ok: false, error: 'rate_limited' }, { status: 429 })),
    );

    render(<GlobalSearchPage initialQuery="launch" />);

    expect(await screen.findByText(/Search is cooling down/)).toBeTruthy();
  });
});
