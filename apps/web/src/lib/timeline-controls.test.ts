import { describe, expect, it } from 'vitest';

import {
  parseTimelineImpact,
  parseTimelineImpacts,
  parseTimelineSource,
  parseTimelineSources,
  timelineHref,
  timelineSourceValues,
} from '@/lib/timeline-controls';

describe('timeline controls', () => {
  it('parses source presets and rejects unknown values', () => {
    expect(parseTimelineSource('slack')).toBe('slack');
    expect(parseTimelineSource('chat')).toBe('chat');
    expect(parseTimelineSource('jira')).toBeUndefined();
  });

  it('maps grouped source filters to concrete event sources', () => {
    expect(timelineSourceValues('chat')).toEqual(['telegram', 'slack']);
    expect(timelineSourceValues('integrations')).toEqual(['integration', 'ingest_webhook']);
    expect(timelineSourceValues('telegram')).toEqual(['telegram']);
  });

  it('parses multiple source filters and expands grouped values once', () => {
    expect(parseTimelineSources('chat,slack,jira,telegram,chat')).toEqual([
      'chat',
      'slack',
      'telegram',
    ]);
    expect(timelineSourceValues(['chat', 'slack', 'integrations'])).toEqual([
      'telegram',
      'slack',
      'integration',
      'ingest_webhook',
    ]);
  });

  it('parses impact presets and rejects unknown values', () => {
    expect(parseTimelineImpact('approval')).toBe('approval');
    expect(parseTimelineImpact('meeting')).toBeUndefined();
  });

  it('parses multiple impact filters and rejects unknown values', () => {
    expect(parseTimelineImpacts('task,document,meeting,task')).toEqual(['task', 'document']);
  });

  it('builds shareable timeline hrefs without empty params', () => {
    expect(timelineHref({ q: 'launch' }, { source: 'slack', impact: null })).toBe(
      '/app/timeline?q=launch&source=slack',
    );
  });
});
