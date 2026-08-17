// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  useDocumentSearchQuery: vi.fn(),
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/lib/use-paginated-queries', () => ({
  useDocumentSearchQuery: fakes.useDocumentSearchQuery,
}));
vi.mock('@/components/collections/virtual-list', () => ({
  VirtualList: ({
    items,
    renderItem,
    getItemKey,
  }: {
    items: { documentChunkId: string }[];
    renderItem: (item: { documentChunkId: string }, index: number) => ReactNode;
    getItemKey: (item: { documentChunkId: string }, index: number) => string;
  }) =>
    createElement(
      'div',
      null,
      items.map((item, index) =>
        createElement('div', { key: getItemKey(item, index) }, renderItem(item, index)),
      ),
    ),
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
  class FakeIntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  fakes.fetchNextPage.mockResolvedValue(undefined);
  fakes.refetch.mockResolvedValue(undefined);
  fakes.useDocumentSearchQuery.mockReturnValue({
    data: undefined,
    isFetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: fakes.fetchNextPage,
    refetch: fakes.refetch,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    expect(screen.getByText('1 document match for Acme security')).toBeTruthy();
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
    expect(screen.getByText('Loading more…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.getByText('Full chunk text about Acme launch security signoff.')).toBeTruthy();
  });

  it('distinguishes no matches from an empty document browser and clears the search', async () => {
    const user = userEvent.setup();
    fakes.useDocumentSearchQuery.mockImplementation((query: string) => ({
      data: query === 'missing plan' ? { pages: [{ items: [], nextOffset: null }] } : undefined,
      isFetching: false,
      isSuccess: query === 'missing plan',
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fakes.fetchNextPage,
    }));

    render(<DocumentSearch />);

    const input = screen.getByRole('searchbox', { name: 'Search document chunks' });
    await user.type(input, 'missing plan');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No matches for “missing plan”')).toBeTruthy();
    expect(screen.getByText(/Try a different phrase/)).toBeTruthy();
    expect(screen.queryByText('No documents yet')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(input).toBeInstanceOf(HTMLInputElement);
    const searchInput = input as HTMLInputElement;
    expect(searchInput.value).toBe('');
    expect(document.activeElement).toBe(searchInput);
    await waitFor(() => {
      expect(fakes.useDocumentSearchQuery).toHaveBeenLastCalledWith('');
    });
    expect(screen.queryByText('No matches for “missing plan”')).toBeNull();
  });

  it.each([
    ['search_unconfigured', /Search is not configured yet/],
    ['qdrant_failed', /Search is temporarily unavailable/],
  ])(
    'announces a failed initial search for %s and retries the submitted query',
    async (errorCode, expectedMessage) => {
      const user = userEvent.setup();
      fakes.useDocumentSearchQuery.mockImplementation((query: string) => ({
        data: undefined,
        error: query === 'Acme security' ? new Error(errorCode) : null,
        isError: query === 'Acme security',
        isFetching: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: fakes.fetchNextPage,
        refetch: fakes.refetch,
      }));

      render(<DocumentSearch />);

      const input = screen.getByRole('searchbox', { name: 'Search document chunks' });
      await user.type(input, '  Acme security  ');
      await user.click(screen.getByRole('button', { name: 'Search' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(expectedMessage);
      expect(screen.queryByText('No matches for “Acme security”')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Retry search' }));

      expect(fakes.refetch).toHaveBeenCalledOnce();
      expect(fakes.useDocumentSearchQuery).toHaveBeenLastCalledWith('Acme security');
      expect((input as HTMLInputElement).value).toBe('  Acme security  ');
    },
  );

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
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(fakes.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
