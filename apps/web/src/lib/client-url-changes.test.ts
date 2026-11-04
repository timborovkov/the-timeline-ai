import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

import { subscribeToClientUrlChanges } from '@/lib/client-url-changes';

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  window.history.replaceState(null, '', '/');
});

describe('subscribeToClientUrlChanges', () => {
  it('notifies on App Router-style pushState fragment navigation', () => {
    const onChange = vi.fn();
    stop = subscribeToClientUrlChanges(onChange);
    window.history.replaceState(null, '', '/app/connections/sources');
    onChange.mockClear();

    window.history.pushState(null, '', '/app/connections/sources#telegram');
    expect(onChange).toHaveBeenCalledTimes(1);

    window.history.pushState(null, '', '/app/connections/sources#email');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('notifies on hashchange and popstate', () => {
    window.history.replaceState(null, '', '/app/connections/sources');
    const onChange = vi.fn();
    stop = subscribeToClientUrlChanges(onChange);

    window.location.hash = 'telegram';
    window.dispatchEvent(new Event('hashchange'));
    expect(onChange).toHaveBeenCalled();

    onChange.mockClear();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not notify when replaceState keeps the current URL', () => {
    window.history.replaceState(null, '', '/app/connections/sources');
    const onChange = vi.fn();
    stop = subscribeToClientUrlChanges(onChange);
    onChange.mockClear();

    window.history.replaceState({ sidebar: 'collapsed' }, '', '/app/connections/sources');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('notifies after Next.js-style history wrap restoration', async () => {
    const nativePush = History.prototype.pushState.bind(window.history);
    const nativeReplace = History.prototype.replaceState.bind(window.history);
    const onChange = vi.fn();
    stop = subscribeToClientUrlChanges(onChange);
    window.history.replaceState(null, '', '/app/connections/sources');
    onChange.mockClear();

    window.history.pushState = nativePush;
    window.history.replaceState = nativeReplace;
    nativePush(null, '', '/app/connections/sources#telegram');

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });
});
