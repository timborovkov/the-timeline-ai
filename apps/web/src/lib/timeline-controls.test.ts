import { describe, expect, it } from 'vitest';

import {
  parseTimelineImpact,
  parseTimelineImpacts,
  parseTimelineOrigins,
  parseTimelineSource,
  parseTimelineSources,
  isTimelinePresetActive,
  TIMELINE_PRESETS,
  timelineHref,
  timelineLoadedCount,
  timelineLoadedSrLabel,
  timelineOriginOptions,
  timelineOriginValue,
  timelinePresetCountLabel,
  timelineSourceValues,
  updateTimelineSourceSelection,
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

  it('round-trips provider and resource origin filters', () => {
    expect(
      parseTimelineOrigins(
        'provider:monday,monday:42,github:acme/app,slack:T123:C456,telegram:-1001,bad:value',
      ),
    ).toEqual([
      { kind: 'provider', provider: 'monday' },
      { kind: 'monday_board', boardId: '42' },
      { kind: 'github_repo', repo: 'acme/app' },
      { kind: 'slack_channel', workspaceId: 'T123', channelId: 'C456' },
      { kind: 'telegram_chat', chatId: '-1001' },
    ]);
    expect(timelineOriginValue({ kind: 'github_repo', repo: 'acme/app' })).toBe('github:acme/app');
  });

  it('builds readable provider and resource options', () => {
    expect(
      timelineOriginOptions([
        {
          filter: { kind: 'provider', provider: 'monday' },
          label: 'monday',
          eventCount: 12,
        },
        {
          filter: { kind: 'monday_board', boardId: '42' },
          label: 'Launch plan',
          eventCount: 8,
        },
      ]),
    ).toEqual([
      { value: 'provider:monday', label: 'Monday.com · All activity' },
      { value: 'monday:42', label: 'Monday.com board · Launch plan' },
    ]);
  });

  it('keeps multiple unnamed Slack channels distinguishable without exposing channel IDs', () => {
    expect(
      timelineOriginOptions([
        {
          filter: { kind: 'slack_channel', workspaceId: 'T1', channelId: 'C2' },
          label: 'Unnamed channel',
          eventCount: 2,
        },
        {
          filter: { kind: 'slack_channel', workspaceId: 'T1', channelId: 'C1' },
          label: 'Unnamed channel',
          eventCount: 1,
        },
      ]),
    ).toEqual([
      { value: 'slack:T1:C2', label: 'Slack channel · Unnamed channel 2' },
      { value: 'slack:T1:C1', label: 'Slack channel · Unnamed channel 1' },
    ]);
  });

  it('lets the most recently selected source scope replace the other scope', () => {
    expect(
      updateTimelineSourceSelection(
        { source: '', origin: 'monday:42' },
        { source: 'integrations' },
      ),
    ).toEqual({ source: 'integrations', origin: '' });
    expect(
      updateTimelineSourceSelection(
        { source: 'integrations', origin: '' },
        { origin: 'monday:42' },
      ),
    ).toEqual({ source: '', origin: 'monday:42' });
    expect(
      updateTimelineSourceSelection({ source: '', origin: 'monday:42' }, { source: '' }),
    ).toEqual({ source: '', origin: 'monday:42' });
  });

  it('does not mark the All preset active while a specific source is selected', () => {
    const allPreset = TIMELINE_PRESETS[0];
    expect(
      isTimelinePresetActive(allPreset, {
        sourceFilters: [],
        impactCount: 0,
        hasOriginFilter: true,
      }),
    ).toBe(false);
    expect(
      isTimelinePresetActive(allPreset, {
        sourceFilters: [],
        impactCount: 0,
        hasOriginFilter: false,
      }),
    ).toBe(true);
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

  it('uses one primary count matching Moments vs Audit trail mode', () => {
    expect(timelineLoadedCount('moments', 7, 12)).toBe(7);
    expect(timelineLoadedCount('events', 7, 12)).toBe(12);
    expect(timelineLoadedSrLabel('moments', 7)).toBe('7 moments loaded');
    expect(timelineLoadedSrLabel('moments', 1)).toBe('1 moment loaded');
    expect(timelineLoadedSrLabel('events', 12)).toBe('12 events loaded');
    expect(timelinePresetCountLabel('moments', 7, 12)).toBe('7 moments');
    expect(timelinePresetCountLabel('moments', 1, 12)).toBe('1 moment');
    expect(timelinePresetCountLabel('events', 7, 12)).toBe('12 source events');
    expect(timelinePresetCountLabel('events', 7, 1)).toBe('1 source event');
  });
});
