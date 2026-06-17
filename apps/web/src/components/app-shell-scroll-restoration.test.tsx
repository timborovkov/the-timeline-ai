// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  pathname: '/app/timeline',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
}));

const { AppMainScrollRestoration } = await import('./app-shell-scroll-restoration.js');

beforeEach(() => {
  routeState.pathname = '/app/timeline';
  window.history.replaceState(null, '', '/app/timeline');
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function addMain(): { main: HTMLElement; scrollTo: ReturnType<typeof vi.fn> } {
  const main = document.createElement('main');
  const scrollTo = vi.fn();
  main.id = 'main';
  main.scrollTo = scrollTo;
  document.body.append(main);
  return { main, scrollTo };
}

describe('AppMainScrollRestoration', () => {
  it('resets the app main scroller on route changes', async () => {
    const { scrollTo } = addMain();
    const { rerender } = render(<AppMainScrollRestoration />);

    routeState.pathname = '/app/objects';
    rerender(<AppMainScrollRestoration />);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0 });
    });
  });

  it('preserves hash navigation by scrolling the target into view', async () => {
    const { main, scrollTo } = addMain();
    const target = document.createElement('section');
    const scrollIntoView = vi.fn();
    target.id = 'capture';
    target.scrollIntoView = scrollIntoView;
    main.append(target);
    window.history.replaceState(null, '', '/app#capture');

    render(<AppMainScrollRestoration />);

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });

  it('resets the app main scroller when the hash points at main itself', async () => {
    const { scrollTo } = addMain();
    window.history.replaceState(null, '', '/app#main');

    render(<AppMainScrollRestoration />);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    });
  });

  it('resets the app main scroller on search param changes', async () => {
    const { scrollTo } = addMain();

    render(<AppMainScrollRestoration />);
    window.history.pushState(null, '', '/app/timeline?focus=mentions');

    await waitFor(() => {
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0 });
    });
  });

  it('ignores history state writes for the current URL', () => {
    const { scrollTo } = addMain();

    render(<AppMainScrollRestoration />);
    scrollTo.mockClear();
    window.history.replaceState({ sidebar: 'collapsed' }, '', '/app/timeline');

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('keeps its URL snapshot current after hash changes', async () => {
    const { main, scrollTo } = addMain();
    const target = document.createElement('section');
    const scrollIntoView = vi.fn();
    target.id = 'capture';
    target.scrollIntoView = scrollIntoView;
    main.append(target);

    render(<AppMainScrollRestoration />);
    scrollTo.mockClear();
    scrollIntoView.mockClear();

    window.location.hash = 'capture';
    window.dispatchEvent(new Event('hashchange'));

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    });

    scrollTo.mockClear();
    scrollIntoView.mockClear();
    window.history.replaceState({ sidebar: 'collapsed' }, '', window.location.href);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('waits briefly for hash targets that mount after navigation', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    });
    vi.mocked(window.cancelAnimationFrame).mockImplementation((frameId) => {
      frames.delete(frameId);
    });

    const runNextFrame = () => {
      const entry = frames.entries().next().value;
      if (!entry) {
        throw new Error('Expected a queued animation frame');
      }
      const [frameId, callback] = entry;
      frames.delete(frameId);
      callback(0);
    };

    const { main, scrollTo } = addMain();
    window.history.replaceState(null, '', '/app#late-target');
    render(<AppMainScrollRestoration />);

    runNextFrame();
    expect(scrollTo).not.toHaveBeenCalled();

    const target = document.createElement('section');
    const scrollIntoView = vi.fn();
    target.id = 'late-target';
    target.scrollIntoView = scrollIntoView;
    main.append(target);
    runNextFrame();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
