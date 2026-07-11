import { describe, expect, it } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';

import { filterObjectsByText, objectMatchesTextFilter } from '@/lib/object-filter';

function row(overrides: Partial<objects.ObjectRow>): objects.ObjectRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'company',
    canonicalName: 'Acme Audit',
    status: 'open',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: false,
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
    archivedAt: null,
    aliases: [],
    metadata: {},
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('objectMatchesTextFilter', () => {
  it('matches canonical names case-insensitively', () => {
    expect(
      objectMatchesTextFilter(row({ canonicalName: 'Digital Audit Company Oy' }), 'audit'),
    ).toBe(true);
  });

  it('requires every token to match somewhere in the row', () => {
    const object = row({
      canonicalName: 'Pilot Pipeline',
      status: 'blocked',
      aliases: ['enterprise rollout'],
    });

    expect(objectMatchesTextFilter(object, 'pipeline blocked rollout')).toBe(true);
    expect(objectMatchesTextFilter(object, 'pipeline closed')).toBe(false);
  });

  it('matches aliases, grouped fields, dates, and metadata primitive values', () => {
    const object = row({
      canonicalName: 'Revigo',
      aliases: ['Monthly accounting partner'],
      stage: 'proposal',
      priority: 2,
      dueAt: new Date('2026-06-11T12:00:00.000Z'),
      metadata: { source: { label: 'LinkedIn lead' } },
    });

    expect(objectMatchesTextFilter(object, 'accounting')).toBe(true);
    expect(objectMatchesTextFilter(object, 'proposal 2')).toBe(true);
    expect(objectMatchesTextFilter(object, '2026-06-11')).toBe(true);
    expect(objectMatchesTextFilter(object, 'linkedin')).toBe(true);
  });

  it('handles serialized due dates without throwing', () => {
    const object = row({
      dueAt: '2026-06-12T09:30:00.000Z' as unknown as Date,
    });

    expect(objectMatchesTextFilter(object, '2026-06-12')).toBe(true);
    expect(objectMatchesTextFilter(object, '09:30')).toBe(true);
  });

  it('matches the displayed unset bucket for nullable group fields', () => {
    const object = row({ stage: null, priority: null });

    expect(objectMatchesTextFilter(object, 'unset', { groupBy: 'stage' })).toBe(true);
    expect(objectMatchesTextFilter(object, 'unset', { groupBy: 'priority' })).toBe(true);
    expect(objectMatchesTextFilter(object, 'unset')).toBe(false);
  });

  it('matches human-readable type labels when provided by the view', () => {
    const person = row({ type: 'person', canonicalName: 'Ada Lovelace' });

    expect(
      objectMatchesTextFilter(person, 'people', {
        typeLabels: { person: 'People', company: 'Companies' },
      }),
    ).toBe(true);
    expect(objectMatchesTextFilter(person, 'people')).toBe(false);
  });
});

describe('filterObjectsByText', () => {
  it('returns the original rows for an empty query', () => {
    const rows = [row({ canonicalName: 'A' }), row({ canonicalName: 'B' })];

    expect(filterObjectsByText(rows, '   ')).toBe(rows);
  });
});
