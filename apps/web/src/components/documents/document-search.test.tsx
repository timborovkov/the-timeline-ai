// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  useDocumentSearchQuery: vi.fn(),
  fetchNextPage: vi.fn(),
}));

vi.mock('@/lib/use-paginated-queries', () => ({
  useDocumentSearchQuery: fakes.useDocumentSearchQuery,
}));

const { DocumentSearch } = await import('./document-search.js');

function documentHit(overrides: Record<string, unknown> = {}) {
  return {
    documentId: '11111111-1111-4111-8111-111111111111',
    documentVersionId: '22222222-2222-4222-8222-222222222222',
    documentChunkId: '33333333-3333-4333-8333-333333333333',
    fileKind: 'document',
    representationKind: 'source_text',
    version: 2,
    chunkIndex: 4,
    pageNumber: 7,
    text: 'Full chunk text about Acme launch security signoff.',
    summary: 'Acme launch requires security signoff before go-live.',
    documentDisplayTitle: 'Acme launch packet',
    documentName: 'acme-launch.txt',
    folderId: null,
    sourceRawEventId: null,
    score: 0.93456,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fetchNextPage.mockResolvedValue(undefined);
  fakes.useDocumentSearchQuery.mockReturnValue({
    data: undefined,
    isFetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: fakes.fetchNextPage,
  });
});

afterEach(() => {
  cleanup();
});

describe('DocumentSearch', () => {
  it('submits trimmed queries and renders cited document chunk links', async () => {
    const user = userEvent.setup();
    fakes.useDocumentSearchQuery.mockImplementation((query: string) => ({
      data:
        query === 'Acme security'
          ? { pages: [{ items: [documentHit()], nextOffset: null }] }
          : undefined,
      isFetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fakes.fetchNextPage,
    }));

    render(<DocumentSearch />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search document chunks' }),
      '  Acme security  ',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(fakes.useDocumentSearchQuery).toHaveBeenLastCalledWith('Acme security');
    });
    const result = await screen.findByRole('link', { name: /Acme launch packet/ });
    expect(result.getAttribute('href')).toBe(
      '/app/documents/11111111-1111-4111-8111-111111111111?version=2#chunk-33333333-3333-4333-8333-333333333333',
    );
    expect(result.textContent).not.toContain('score 0.935');
    expect(result.textContent).not.toContain('source text');
    expect(result.textContent).toContain('v2 · document · page 7');
    expect(result.textContent).toContain('Acme launch requires security signoff');
  });

  it('shows search and pagination loading states', async () => {
    const user = userEvent.setup();
    fakes.useDocumentSearchQuery.mockImplementation((query: string) => ({
      data:
        query === 'Acme'
          ? { pages: [{ items: [documentHit({ summary: null })], nextOffset: 12 }] }
          : undefined,
      isFetching: query === 'Acme',
      hasNextPage: query === 'Acme',
      isFetchingNextPage: query === 'Acme',
      fetchNextPage: fakes.fetchNextPage,
    }));

    render(<DocumentSearch />);

    await user.type(screen.getByRole('searchbox', { name: 'Search document chunks' }), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const searching = await screen.findByRole('button', { name: 'Searching' });
    expect(searching).toBeInstanceOf(HTMLButtonElement);
    expect((searching as HTMLButtonElement).disabled).toBe(true);
    const loadMore = await screen.findByRole('button', { name: 'Loading…' });
    expect(loadMore).toBeInstanceOf(HTMLButtonElement);
    expect((loadMore as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Full chunk text about Acme launch security signoff.')).toBeTruthy();
  });

  it('loads the next result page when more chunks are available', async () => {
    const user = userEvent.setup();

    fakes.useDocumentSearchQuery.mockReturnValue({
      data: { pages: [{ items: [documentHit()], nextOffset: 12 }] },
      isFetching: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fakes.fetchNextPage,
    });

    render(<DocumentSearch />);
    await user.type(screen.getByRole('searchbox', { name: 'Search document chunks' }), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(fakes.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
