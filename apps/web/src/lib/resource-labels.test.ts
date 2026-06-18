import { describe, expect, it } from 'vitest';

import {
  groupResourcesByKind,
  providerLabel,
  resourceDisplayName,
  resourceKindLabel,
  shareDisplayName,
  type ProviderResourceLike,
  type ResourceShareLike,
} from '@/lib/resource-labels';

describe('resource labels', () => {
  it('maps provider ids to human names', () => {
    expect(providerLabel('google_drive')).toBe('Google Drive');
    expect(providerLabel('linear')).toBe('Linear');
    expect(providerLabel('github')).toBe('GitHub');
    expect(providerLabel('unknown')).toBe('unknown');
  });

  it('maps raw resource kinds to human labels', () => {
    expect(resourceKindLabel('github.org')).toBe('GitHub organization');
    expect(resourceKindLabel('github.repo')).toBe('GitHub repository');
    expect(resourceKindLabel('linear.team')).toBe('Linear team');
    expect(resourceKindLabel('drive.shared_drive')).toBe('Google Drive shared drive');
    expect(resourceKindLabel('drive.folder')).toBe('Google Drive folder');
  });

  it('falls back to a cleaned-up kind for unknown values', () => {
    expect(resourceKindLabel('custom.thing')).toBe('custom thing');
  });

  it('prefers the label for display, falls back to externalId', () => {
    expect(resourceDisplayName({ kind: 'github.repo', externalId: 'acme/app', label: 'App' })).toBe(
      'App',
    );
    expect(resourceDisplayName({ kind: 'github.repo', externalId: 'acme/app', label: '' })).toBe(
      'acme/app',
    );
  });

  it('prefers externalLabel for shares, falls back to externalId', () => {
    expect(
      shareDisplayName({
        resourceKind: 'github.repo',
        externalId: 'acme/app',
        externalLabel: 'App',
      }),
    ).toBe('App');
    expect(
      shareDisplayName({
        resourceKind: 'github.repo',
        externalId: 'acme/app',
        externalLabel: null,
      }),
    ).toBe('acme/app');
  });

  it('groups resources by kind with human labels', () => {
    const resources: ProviderResourceLike[] = [
      { kind: 'github.org', externalId: 'acme', label: 'Acme' },
      { kind: 'github.repo', externalId: 'acme/app', label: 'App' },
      { kind: 'github.repo', externalId: 'acme/web', label: 'Web' },
    ];
    const groups = groupResourcesByKind(resources);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe('GitHub organization');
    expect(groups[0]?.resources).toHaveLength(1);
    expect(groups[1]?.label).toBe('GitHub repository');
    expect(groups[1]?.resources).toHaveLength(2);
  });

  it('handles empty resource lists', () => {
    expect(groupResourcesByKind([])).toEqual([]);
  });

  it('ResourceShareLike type is usable', () => {
    const share: ResourceShareLike = {
      resourceKind: 'linear.team',
      externalId: 'eng',
      externalLabel: 'Engineering',
    };
    expect(shareDisplayName(share)).toBe('Engineering');
  });
});
