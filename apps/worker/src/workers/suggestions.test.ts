import { describe, expect, it } from 'vitest';

import { fallbackBundles } from '#src/workers/suggestions.js';

const REFERENCE_DATE = new Date('2026-05-27T10:00:00.000Z');

describe('fallbackBundles', () => {
  it('does not treat next inside the action text as the time phrase', () => {
    const [bundle] = fallbackBundles({
      text: "I'll review the next quarter plan tomorrow.",
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });

    expect(bundle?.items[0]?.title).toBe('Review the next quarter plan');
    expect(bundle?.items[0]?.proposedPayload).toMatchObject({
      canonicalName: 'Review the next quarter plan',
      metadata: { extracted_from_commitment: true, time_phrase: 'tomorrow' },
    });
    expect(bundle?.items[1]?.proposedPayload).toMatchObject({
      startDate: '2026-05-28',
      endDate: '2026-05-29',
      allDay: true,
    });
  });

  it('still supports next weekday phrases', () => {
    const [bundle] = fallbackBundles({
      text: 'I will send the memo next Tuesday',
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: null,
    });

    expect(bundle?.items[0]?.title).toBe('Send the memo');
    expect(bundle?.items[1]?.proposedPayload).toMatchObject({
      startDate: '2026-06-02',
      endDate: '2026-06-03',
    });
  });

  it('uses the sentence nearest the time phrase as the commitment title', () => {
    const [bundle] = fallbackBundles({
      text: "I'll update the pricing. And schedule the follow-up tomorrow",
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: null,
    });

    expect(bundle?.items[0]?.title).toBe('Schedule the follow-up');
    expect(bundle?.items[0]?.proposedPayload).toMatchObject({
      canonicalName: 'Schedule the follow-up',
      metadata: { extracted_from_commitment: true, time_phrase: 'tomorrow' },
    });
  });
});
