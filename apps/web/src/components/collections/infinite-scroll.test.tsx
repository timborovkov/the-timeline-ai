// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InfiniteScroll } from '@/components/collections/infinite-scroll';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly unobserve = vi.fn();
  readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  trigger(isIntersecting: boolean): void {
    this.callback(
      [
        {
          isIntersecting,
          target: document.createElement('div'),
        } as unknown as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

describe('InfiniteScroll', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads more when the sentinel intersects or receives focus', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <InfiniteScroll
        hasMore
        loading={false}
        onLoadMore={onLoadMore}
        boundLabel="No more matching tasks"
      />,
    );

    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    FakeIntersectionObserver.instances[0]?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledOnce();

    onLoadMore.mockClear();
    rerender(
      <InfiniteScroll
        hasMore
        loading={false}
        onLoadMore={onLoadMore}
        boundLabel="No more matching tasks"
      />,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('re-observes the sentinel after loading finishes so the next page can load', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <InfiniteScroll hasMore onLoadMore={onLoadMore} boundLabel="No older activity" />,
    );
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    FakeIntersectionObserver.instances[0]?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(
      <InfiniteScroll hasMore loading onLoadMore={onLoadMore} boundLabel="No older activity" />,
    );
    expect(screen.getByRole('status').textContent).toBe('Loading more…');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    onLoadMore.mockClear();
    rerender(<InfiniteScroll hasMore onLoadMore={onLoadMore} boundLabel="No older activity" />);
    const observer = FakeIntersectionObserver.instances.at(-1);
    expect(observer).toBeTruthy();
    observer?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('shows a quiet loading status and bound copy without a Load more button', () => {
    const { rerender } = render(
      <InfiniteScroll hasMore loading onLoadMore={vi.fn()} boundLabel="No older activity" />,
    );
    expect(screen.getByRole('status').textContent).toBe('Loading more…');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    rerender(
      <InfiniteScroll hasMore={false} onLoadMore={vi.fn()} boundLabel="No older activity" />,
    );
    expect(screen.getByRole('status').textContent).toBe('No older activity');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('renders custom loading content instead of the Loading more label', () => {
    render(
      <InfiniteScroll
        hasMore
        loading
        onLoadMore={vi.fn()}
        boundLabel="No more matching tasks"
        loadingContent={<div data-testid="load-skeleton">skeleton</div>}
      />,
    );
    expect(screen.getByTestId('load-skeleton')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading more' })).toBeTruthy();
    expect(screen.queryByText('Loading more…')).toBeNull();
  });

  it('locks a second load request until the first call can report loading', () => {
    const onLoadMore = vi.fn();
    render(
      <InfiniteScroll hasMore onLoadMore={onLoadMore} boundLabel="No more matching tasks" />,
    );
    const observer = FakeIntersectionObserver.instances[0];
    observer?.trigger(true);
    observer?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('does not observe the page scroller while a nested root is still mounting', () => {
    const onLoadMore = vi.fn();
    render(
      <InfiniteScroll
        hasMore
        root={null}
        onLoadMore={onLoadMore}
        boundLabel="No more matching tasks"
      />,
    );
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('keeps Retry as the only visible control after a load failure', () => {
    const onRetry = vi.fn();
    render(
      <InfiniteScroll
        hasMore
        error="More tasks could not load."
        onLoadMore={vi.fn()}
        onRetry={onRetry}
        boundLabel="No more matching tasks"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
