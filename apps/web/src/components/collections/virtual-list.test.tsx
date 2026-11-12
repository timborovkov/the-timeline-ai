import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const virtualizerOptions = vi.hoisted(() => ({
  window: null as null | [number, number],
  current: null as null | { getScrollElement: () => HTMLElement | null; scrollMargin: number },
}));

await vi.mock(
  import.meta.resolve('@tanstack/react-virtual'),
  () => ({
    useVirtualizer: (options: {
      count: number;
      getScrollElement: () => HTMLElement | null;
      scrollMargin: number;
    }) => {
      virtualizerOptions.current = options;
      const { count, scrollMargin } = options;
      return {
        getTotalSize: () => count * 40,
        getVirtualItems: () =>
          Array.from({ length: count }, (_, index) => ({
            key: String(index),
            index,
            start: index * 40 + scrollMargin,
            size: 40,
            end: (index + 1) * 40,
          })).slice(...(virtualizerOptions.window ?? [0, count])),
        measureElement: vi.fn(),
      };
    },
  }),
  () => import('@tanstack/react-virtual'),
);

const { act, cleanup, render, screen } = await import('@testing-library/react');

const { VirtualList } = await import('./virtual-list.js');

describe('VirtualList', () => {
  afterEach(() => {
    cleanup();
    virtualizerOptions.window = null;
    vi.restoreAllMocks();
  });

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

  it('keeps an offset list anchored to its own scrollport when preceding content resizes', () => {
    const root = document.createElement('div');
    root.id = 'nested-scrollport';
    root.scrollTop = 120;
    document.body.append(root);
    let listTop = 180;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return {
        top: this === root ? 20 : listTop,
        left: 0,
        right: 400,
        bottom: 400,
        width: 400,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
    let resize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect() {
          disconnect();
        }
      },
    );
    const { container, unmount } = render(
      <VirtualList
        items={['one', 'two']}
        getItemKey={(item) => item}
        estimateSize={40}
        getScrollElement={() => root}
        offsetWithinScrollElement
        renderItem={(item) => <p>{item}</p>}
      />,
    );
    expect(virtualizerOptions.current?.getScrollElement()).toBe(root);
    expect(virtualizerOptions.current?.scrollMargin).toBe(280);
    expect(
      container.querySelector<HTMLElement>('[data-index="0"]')?.parentElement?.style.paddingTop,
    ).toBe('0px');
    listTop = 240;
    act(() => {
      resize?.([], {} as ResizeObserver);
    });
    expect(virtualizerOptions.current?.scrollMargin).toBe(340);
    expect(
      container.querySelector<HTMLElement>('[data-index="1"]')?.parentElement?.style.paddingTop,
    ).toBe('0px');
    unmount();
    expect(disconnect).toHaveBeenCalled();
    root.remove();
    vi.unstubAllGlobals();
  });

  it('reserves space outside the rendered window without fixing row heights', () => {
    virtualizerOptions.window = [2, 5];
    const { container } = render(
      <VirtualList
        items={Array.from({ length: 10 }, (_, index) => String(index))}
        getItemKey={(item) => item}
        estimateSize={40}
        renderItem={(item) => <p>{item}</p>}
      />,
    );
    const row = container.querySelector<HTMLElement>('[data-index="2"]');
    expect(row?.parentElement?.style.paddingTop).toBe('80px');
    expect(row?.parentElement?.style.paddingBottom).toBe('200px');
    expect(row?.style.height).toBe('');
    expect(row?.className).not.toContain('absolute');
    expect(container.querySelector('[data-index="1"]')).toBeNull();
    expect(container.querySelector('[data-index="5"]')).toBeNull();
  });

  it('waits for an explicit nested scrollport instead of binding to a fallback', () => {
    render(
      <VirtualList
        items={['one']}
        getItemKey={(item) => item}
        estimateSize={40}
        getScrollElement={() => null}
        offsetWithinScrollElement
        renderItem={(item) => <p>{item}</p>}
      />,
    );
    expect(virtualizerOptions.current?.getScrollElement()).toBeNull();
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
