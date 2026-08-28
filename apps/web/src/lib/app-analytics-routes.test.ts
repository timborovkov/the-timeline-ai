import { describe, expect, it } from 'vitest';

import { classifyAppAnalyticsPath } from '@/lib/app-analytics-routes';

describe('app analytics route classification', () => {
  it('maps static app routes to stable surface enums', () => {
    expect(classifyAppAnalyticsPath('/app')).toBe('home');
    expect(classifyAppAnalyticsPath('/app/timeline')).toBe('timeline');
    expect(classifyAppAnalyticsPath('/app/team/integrations/audit')).toBe('team_integrations');
  });

  it('collapses dynamic identifiers into fixed detail surfaces', () => {
    expect(classifyAppAnalyticsPath('/app/boards/board-secret-id')).toBe('board_detail');
    expect(classifyAppAnalyticsPath('/app/objects/object-secret-id')).toBe('object_detail');
    expect(classifyAppAnalyticsPath('/app/documents/document-secret-id')).toBe('document_detail');
    expect(classifyAppAnalyticsPath('/app/meetings/meeting-secret-id')).toBe('meeting_detail');
    expect(classifyAppAnalyticsPath('/app/team/reconciliation/clusters/cluster-secret-id')).toBe(
      'team_reconciliation',
    );
  });

  it('fails closed for unknown, token-bearing, query, and malformed paths', () => {
    expect(classifyAppAnalyticsPath('/app/team/switch/team-secret-id')).toBeUndefined();
    expect(classifyAppAnalyticsPath('/app/unknown')).toBeUndefined();
    expect(classifyAppAnalyticsPath('/app/timeline?event=secret')).toBeUndefined();
    expect(classifyAppAnalyticsPath('/app/timeline/')).toBeUndefined();
    expect(classifyAppAnalyticsPath('https://thetimeline.cc/app')).toBeUndefined();
  });
});
