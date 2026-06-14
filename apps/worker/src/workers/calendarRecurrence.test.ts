import { afterEach, describe, expect, it, vi } from 'vitest';

import { processCalendarRecurrenceTick } from '#src/workers/calendarRecurrence.js';

const fakes = vi.hoisted(() => ({
  withTeam: vi.fn(),
}));

vi.mock('@timeline/shared', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    withTeam: fakes.withTeam,
  };
});

function makeDb(pages: { teamId: string }[][]) {
  return {
    selectDistinct: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(pages.shift() ?? [])),
          })),
        })),
      })),
    })),
  };
}

describe('processCalendarRecurrenceTick', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('pages recurring teams instead of stopping after the first thousand', async () => {
    const page1 = Array.from({ length: 1000 }, (_, index) => ({
      teamId: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
    }));
    const page2 = [{ teamId: '00000000-0000-0000-0000-999999999999' }];
    const materializeRecurringEvents = vi.fn(() => Promise.resolve(1));
    fakes.withTeam.mockReturnValue({ calendar: { materializeRecurringEvents } });

    const result = await processCalendarRecurrenceTick(
      { db: makeDb([page1, page2]) as never },
      'test-job',
    );

    expect(result).toEqual({ materialized: 1001 });
    expect(fakes.withTeam).toHaveBeenCalledTimes(1001);
    expect(materializeRecurringEvents).toHaveBeenCalledTimes(1001);
  });
});
