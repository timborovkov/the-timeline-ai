import { describe, expect, it } from 'vitest';

import { buildExtractionPrompt } from './prompt';

describe('buildExtractionPrompt', () => {
  it('includes the current event under a labelled header', () => {
    const out = buildExtractionPrompt({
      current: { occurredAt: '2026-05-20T10:00:00Z', text: 'Met John' },
      recent: [],
    });
    expect(out).toContain('# Current event');
    expect(out).toContain('[2026-05-20T10:00:00Z] Met John');
    expect(out).not.toContain('# Recent events');
  });

  it('emits the recent context with a non-extraction warning header', () => {
    const out = buildExtractionPrompt({
      current: { occurredAt: '2026-05-20T10:00:00Z', text: 'Met John' },
      recent: [{ occurredAt: '2026-05-19T09:00:00Z', text: 'Called Apple' }],
    });
    expect(out).toContain('# Recent events (context only');
    expect(out).toContain('Called Apple');
    // Order: recent block precedes current block.
    expect(out.indexOf('Called Apple')).toBeLessThan(out.indexOf('Met John'));
  });

  it('truncates per-event text past the cap with an ellipsis', () => {
    const big = 'x'.repeat(2000);
    const out = buildExtractionPrompt({
      current: { occurredAt: 't0', text: 'short' },
      recent: [{ occurredAt: 't-1', text: big }],
    });
    expect(out).toContain('xxx…');
    // The current event text should still be present in full.
    expect(out).toContain('short');
  });

  it('stops adding recent events once the context budget is exhausted', () => {
    const filler = 'y'.repeat(700);
    const recent = Array.from({ length: 10 }, (_, i) => ({
      occurredAt: `t-${i}`,
      text: filler,
    }));
    const out = buildExtractionPrompt({
      current: { occurredAt: 't0', text: 'current' },
      recent,
    });
    // Should NOT contain every entry — budget cuts off well before all 10.
    const matches = out.match(/t-\d+/g) ?? [];
    expect(matches.length).toBeLessThan(10);
    expect(matches.length).toBeGreaterThan(0);
  });
});
