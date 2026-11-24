import { act, cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { Suspense, use } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { RegionalDate } from '@/components/regional-date';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';
import { formatDisplayDateTime, formatRelativeAge } from '@/lib/display-dates';
// Test environment: happy-dom

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RelativeTimestamp', () => {
  it('shows relative age and keeps the formatted timestamp for hover', () => {
    const now = new Date('2026-08-19T12:00:00.000Z');
    vi.setSystemTime(now);
    const value = new Date('2026-08-19T05:00:00.000Z');

    render(
      <WorkspaceTimezoneProvider timezone="UTC">
        <RelativeTimestamp value={value} prefix="Updated" />
      </WorkspaceTimezoneProvider>,
    );

    const time = screen.getByText('Updated 7 hours ago');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('dateTime')).toBe(value.toISOString());
    expect(time.getAttribute('title')).toBe(formatDisplayDateTime(value, { timezone: 'UTC' }));
    expect(formatRelativeAge(value, { now })).toBe('7 hours ago');
  });

  it('hydrates the same absolute date from saved regional preferences', async () => {
    const value = '2026-07-01T00:15:00Z';
    const element = (
      <WorkspaceTimezoneProvider
        timezone="Asia/Tokyo"
        region={{ locale: 'de-DE', timezone: 'America/Los_Angeles' }}
      >
        <RegionalDate value={value} variant="datetime" />
      </WorkspaceTimezoneProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(element);
    const expected = formatDisplayDateTime(value, {
      locale: 'de-DE',
      timezone: 'America/Los_Angeles',
    });
    expect(container.querySelector('time')?.textContent).toBe(expected);
    const errors: unknown[] = [];
    const root = hydrateRoot(container, element, {
      onRecoverableError: (error) => errors.push(error),
    });
    try {
      await act(() => Promise.resolve());
      expect(container.querySelector('time')?.textContent).toBe(expected);
      expect(errors).toEqual([]);
    } finally {
      act(() => {
        root.unmount();
      });
    }
  });

  it('hydrates delayed date content before switching it to the automatic browser region', async () => {
    const value = '2026-12-01T00:15:00Z';
    const expected = (timezone: string) =>
      formatDisplayDateTime(value, { locale: 'en-US', timezone });
    const workspace = expected('Europe/Helsinki');
    const browser = expected('America/Los_Angeles');
    const browserOptions = new Intl.DateTimeFormat().resolvedOptions();
    const browserZone = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ ...browserOptions, timeZone: 'America/Los_Angeles' });
    const gate = Promise.withResolvers<undefined>();
    let deferHydration = false;

    function DeferredDate() {
      if (deferHydration) use(gate.promise);
      return <RegionalDate value={value} variant="datetime" />;
    }

    const element = (
      <WorkspaceTimezoneProvider timezone="Europe/Helsinki" region={{ browserLocale: 'en-US' }}>
        <RegionalDate value={value} variant="datetime" />
        <Suspense fallback={null}>
          <DeferredDate />
        </Suspense>
      </WorkspaceTimezoneProvider>
    );
    const container = document.createElement('div');
    const dates = () => Array.from(container.querySelectorAll('time'), (node) => node.textContent);
    container.innerHTML = renderToString(element);
    expect(dates()).toEqual([workspace, workspace]);

    deferHydration = true;
    const errors: unknown[] = [];
    const root = hydrateRoot(container, element, {
      onRecoverableError: (error) => errors.push(error),
    });
    try {
      await act(() => Promise.resolve());
      expect(dates()).toEqual([browser, workspace]);
      await act(() => {
        gate.resolve(undefined);
        return gate.promise;
      });
      expect(dates()).toEqual([browser, browser]);
      expect(errors).toEqual([]);
    } finally {
      act(() => {
        root.unmount();
      });
      browserZone.mockRestore();
    }
  });

  it('renders the empty fallback when no instant is available', () => {
    render(<RelativeTimestamp value={null} empty="Never synced" />);
    expect(screen.getByText('Never synced')).toBeTruthy();
  });
});
