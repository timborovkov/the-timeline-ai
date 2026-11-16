// Crawl usage and calendar scheduling must agree across billing, the app, and DST changes.
import { describe, expect, it } from 'bun:test';

import { nextWebsiteScan, normalizeWebsiteUrl } from '#src/websites/policy.js';
import { estimateWebsiteUsage, websiteSourceUnits } from '#src/websites/usage.js';
describe('website policy', () => {
  it('charges twenty source units for each captured page', () => {
    expect(websiteSourceUnits(5)).toBe(100);
    expect(websiteSourceUnits(5, 1)).toBe(5);
    expect(
      estimateWebsiteUsage({ websites: 1, pages: 5, frequency: 'daily', manualScans: 0 })
        .sourceUnits,
    ).toBe(3000);
    expect(() => websiteSourceUnits(-1)).toThrow();
  });
  it('preserves meaningful URL paths and queries but removes fragments and default ports', () => {
    expect(normalizeWebsiteUrl('https://example.com:443/products?lang=en#details')).toBe(
      'https://example.com/products?lang=en',
    );
    expect(() => normalizeWebsiteUrl('http://127.0.0.1')).toThrow();
  });
  it('uses local daily time across spring DST and only one future occurrence', () => {
    const schedule = {
      frequency: 'daily' as const,
      time: '09:00',
      weekday: 1,
      timezone: 'Europe/London',
    };
    expect(nextWebsiteScan(schedule, new Date('2026-03-28T10:00:00Z'))?.toISOString()).toBe(
      '2026-03-29T08:00:00.000Z',
    );
    expect(nextWebsiteScan(schedule, new Date('2026-10-24T10:00:00Z'))?.toISOString()).toBe(
      '2026-10-25T09:00:00.000Z',
    );
  });
  it('moves a missed weekly slot to the next matching local weekday', () => {
    expect(
      nextWebsiteScan(
        { frequency: 'weekly', time: '09:00', weekday: 1, timezone: 'UTC' },
        new Date('2026-11-11T12:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-11-16T09:00:00.000Z');
  });
});
