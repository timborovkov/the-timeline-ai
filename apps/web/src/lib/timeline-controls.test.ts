import { describe, expect, it } from 'vitest';

import {
  parseTimelineDensity,
  parseTimelineImpact,
  parseTimelineSource,
  timelineHref,
} from '@/lib/timeline-controls';

describe('timeline controls', () => {
  it('parses source presets and rejects unknown values', () => {
    expect(parseTimelineSource('slack')).toBe('slack');
    expect(parseTimelineSource('jira')).toBeUndefined();
  });

  it('parses impact presets and rejects unknown values', () => {
    expect(parseTimelineImpact('approval')).toBe('approval');
    expect(parseTimelineImpact('meeting')).toBeUndefined();
  });

  it('defaults density to comfortable unless dense is requested', () => {
    expect(parseTimelineDensity(undefined)).toBe('comfortable');
    expect(parseTimelineDensity('comfortable')).toBe('comfortable');
    expect(parseTimelineDensity('dense')).toBe('dense');
  });

  it('builds shareable timeline hrefs without empty params', () => {
    expect(timelineHref({ q: 'launch', density: null }, { source: 'slack', impact: null })).toBe(
      '/app/timeline?q=launch&source=slack',
    );
  });
});
