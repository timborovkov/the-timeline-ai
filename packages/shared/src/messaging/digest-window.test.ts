import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { scheduledUpdateWindow } from '#src/messaging/digest-window.js';

describe('scheduledUpdateWindow', () => {
  it('uses local Monday boundaries through spring DST', () => {
    const actual = scheduledUpdateWindow(
      new Date('2026-03-30T11:00:00Z'),
      'Europe/London',
      12,
      'weekly',
    );
    expect(actual).toEqual({
      start: new Date('2026-03-23T12:00:00Z'),
      end: new Date('2026-03-30T11:00:00Z'),
    });
  });

  it('keeps the previous weekly boundary until the local hour', () => {
    const actual = scheduledUpdateWindow(
      new Date('2026-11-02T11:59:59Z'),
      'Europe/London',
      12,
      'weekly',
    );
    expect(actual.end).toEqual(new Date('2026-10-26T12:00:00Z'));
  });

  it('keeps adjacent daily windows contiguous through autumn DST', () => {
    const sunday = scheduledUpdateWindow(
      new Date('2026-10-25T12:00:00Z'),
      'Europe/London',
      12,
      'daily',
    );
    const monday = scheduledUpdateWindow(
      new Date('2026-10-26T12:00:00Z'),
      'Europe/London',
      12,
      'daily',
    );
    expect(sunday.start).toEqual(new Date('2026-10-24T11:00:00Z'));
    expect(monday.start).toEqual(sunday.end);
  });
});
