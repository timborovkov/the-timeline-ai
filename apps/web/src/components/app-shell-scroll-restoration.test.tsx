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
});
