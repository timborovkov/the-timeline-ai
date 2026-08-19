// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RelativeTimestamp } from '@/components/relative-timestamp';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';
import { formatDisplayDateTime, formatRelativeAge } from '@/lib/display-dates';

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

  it('renders the empty fallback when no instant is available', () => {
    render(<RelativeTimestamp value={null} empty="Never synced" />);
    expect(screen.getByText('Never synced')).toBeTruthy();
  });
});
