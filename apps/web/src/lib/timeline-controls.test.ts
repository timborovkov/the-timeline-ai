import { describe, expect, it } from 'vitest';

import { parseTimelineImpact, parseTimelineSource, timelineHref } from '@/lib/timeline-controls';

describe('timeline controls', () => {
  it('parses source presets and rejects unknown values', () => {
    expect(parseTimelineSource('slack')).toBe('slack');
    expect(parseTimelineSource('jira')).toBeUndefined();
  });

  it('parses impact presets and rejects unknown values', () => {
    expect(parseTimelineImpact('approval')).toBe('approval');
    expect(parseTimelineImpact('meeting')).toBeUndefined();
  });

  it('builds shareable timeline hrefs without empty params', () => {
    expect(timelineHref({ q: 'launch' }, { source: 'slack', impact: null })).toBe(
      '/app/timeline?q=launch&source=slack',
    );
  });
});
