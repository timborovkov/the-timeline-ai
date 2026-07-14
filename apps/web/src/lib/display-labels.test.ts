import { describe, expect, it } from 'vitest';

import {
  displayArtifactLabel,
  displayMeetingLabel,
  displayMemberLabel,
  displayObjectLabel,
  displayRemovedMemberLabel,
  displaySourceLabel,
  isInternalIdentifier,
} from '@/lib/display-labels';

const UUID = '8e5b28ae-4ba1-4a52-9d8f-7e9fb57be7a4';

describe('display labels', () => {
  it('never uses UUID-only values as human labels', () => {
    const labels = [
      displayMemberLabel({ name: UUID, email: UUID }),
      displayRemovedMemberLabel({ name: UUID, email: UUID }),
      displayObjectLabel({ canonicalName: UUID, title: UUID }),
      displayMeetingLabel({ title: UUID, providerDescription: UUID }),
      displaySourceLabel({ name: UUID, provider: UUID }),
      displayArtifactLabel({ canonicalName: UUID, artifactType: UUID }),
    ];

    expect(labels).not.toContain(UUID);
    expect(labels.every((label) => !label.includes(UUID))).toBe(true);
  });

  it('uses the preferred human-readable fallback order', () => {
    expect(displayMemberLabel({ name: 'Ada', email: 'ada@example.com' })).toBe('Ada');
    expect(displayMemberLabel({ email: 'ada@example.com' })).toBe('ada@example.com');
    expect(displayObjectLabel({ canonicalName: 'Launch plan' })).toBe('Launch plan');
    expect(displayMeetingLabel({ providerDescription: 'Zoom call' })).toBe('Zoom call');
    expect(displaySourceLabel('github')).toBe('GitHub');
    expect(displayArtifactLabel({ artifactType: 'pull_request' })).toBe('Untitled pull request');
  });

  it('recognizes UUIDs embedded in values', () => {
    expect(isInternalIdentifier(UUID)).toBe(true);
    expect(isInternalIdentifier(`item ${UUID}`)).toBe(true);
    expect(isInternalIdentifier('TL-101')).toBe(false);
  });
});
