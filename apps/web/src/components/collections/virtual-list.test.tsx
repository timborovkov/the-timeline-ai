// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: String(index),
        index,
        start: index * 40,
        size: 40,
        end: (index + 1) * 40,
      })),
    measureElement: vi.fn(),
  }),
}));

const { VirtualList } = await import('./virtual-list.js');

describe('VirtualList', () => {
  afterEach(cleanup);

  it('renders the visible window of items through the shared row callback', () => {
    render(
      <VirtualList
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        getItemKey={(item) => item.id}
        estimateSize={40}
        renderItem={(item) => <p>{item.label}</p>}
      />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('asks for the next page when the rendered window reaches the end', () => {
    const onEndReached = vi.fn();
    const { rerender } = render(
      <VirtualList
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        getItemKey={(item) => item.id}
        estimateSize={40}
        overscan={1}
        onEndReached={onEndReached}
        renderItem={(item) => <p>{item.label}</p>}
      />,
    );
    expect(onEndReached).toHaveBeenCalledOnce();

    onEndReached.mockClear();
    rerender(
      <VirtualList
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        getItemKey={(item) => item.id}
        estimateSize={40}
        overscan={1}
        onEndReached={onEndReached}
        renderItem={(item) => <p>{item.label}</p>}
      />,
    );
    expect(onEndReached).not.toHaveBeenCalled();

    rerender(
      <VirtualList
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
          { id: 'c', label: 'Gamma' },
        ]}
        getItemKey={(item) => item.id}
        estimateSize={40}
        overscan={1}
        onEndReached={onEndReached}
        renderItem={(item) => <p>{item.label}</p>}
      />,
    );
    expect(onEndReached).toHaveBeenCalledOnce();
  });
});
