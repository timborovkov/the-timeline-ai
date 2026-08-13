import { describe, expect, it } from 'vitest';

import {
  CAPTURE_SURFACES,
  CAPTURE_SURFACE_SUMMARY,
} from '@/components/marketing/integrations/capture-surface-content';

describe('capture surface content', () => {
  it('keeps key capture paths visible and separate from provider record sync', () => {
    expect(CAPTURE_SURFACES.map((surface) => surface.id)).toEqual([
      'telegram',
      'slack-chat',
      'email',
      'meetings',
      'webhooks',
    ]);
    expect(CAPTURE_SURFACES.filter((surface) => surface.featured).map(({ id }) => id)).toEqual([
      'telegram',
      'slack-chat',
    ]);
    expect(CAPTURE_SURFACE_SUMMARY.canonicalPath).toBe('/integrations');
  });

  it('states the important provider and evidence boundaries', () => {
    const content = JSON.stringify(CAPTURE_SURFACES);

    expect(content).toContain('does not silently become team evidence');
    expect(content).toContain('separate from the Slack history connector');
    expect(content).toContain('Forward, CC, or BCC');
    expect(content).toContain('Google Meet, Microsoft Teams, and Zoom');
    expect(content).toContain('not a copy of the raw meeting audio');
    expect(content).toContain('evidence-only sources');
    expect(content).toContain('direct file or binary upload uses a separate capture path');
  });
});
