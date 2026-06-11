import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));

const { HistoryBackLink } = await import('./history-back-link.js');
const { canUseAppHistory, shouldUseHistoryBackClick } = await import('@/lib/history-back');

function stubBrowser({
  historyIndex,
  historyLength,
  referrer,
}: {
  historyIndex?: number;
  historyLength: number;
  referrer: string;
}) {
  vi.stubGlobal('window', {
    history: {
      state: historyIndex === undefined ? {} : { idx: historyIndex },
      length: historyLength,
    },
    location: { origin: 'https://timeline.test' },
  });
  vi.stubGlobal('document', { referrer });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('HistoryBackLink', () => {
  it('renders a normal fallback Link target for direct loads', () => {
    const html = renderToStaticMarkup(
      createElement(HistoryBackLink, { fallbackHref: '/app/objects', label: 'Back' }),
    );

    expect(html).toContain('href="/app/objects"');
    expect(html).toContain('Back');
  });

  it('uses app history when Next has a previous route entry', () => {
    stubBrowser({ historyIndex: 2, historyLength: 3, referrer: '' });

    expect(canUseAppHistory()).toBe(true);
  });

  it('falls back when the current page was opened directly', () => {
    stubBrowser({ historyLength: 1, referrer: '' });

    expect(canUseAppHistory()).toBe(false);
  });

  it('falls back instead of leaving the app for an external referrer', () => {
    stubBrowser({ historyLength: 4, referrer: 'https://example.com/start' });

    expect(canUseAppHistory()).toBe(false);
  });

  it('allows same-origin browser history when no Next index is available', () => {
    stubBrowser({ historyLength: 2, referrer: 'https://timeline.test/app/objects' });

    expect(canUseAppHistory()).toBe(true);
  });

  it('preserves normal link behavior for modified clicks', () => {
    stubBrowser({ historyIndex: 2, historyLength: 3, referrer: '' });

    expect(
      shouldUseHistoryBackClick({
        altKey: false,
        button: 0,
        ctrlKey: false,
        defaultPrevented: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(false);
  });
});
