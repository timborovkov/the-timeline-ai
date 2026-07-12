import { describe, expect, it, vi } from 'vitest';

import type { ObjectListFilter, ObjectRow } from '@timeline/shared/objects/types';

import { loadProjectFilterRows } from '@/lib/project-filter-options';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

describe('loadProjectFilterRows', () => {
  it('hydrates an exact selected project even when it is archived', async () => {
    const archivedProject = {
      id: PROJECT_ID,
      canonicalName: 'Archived redesign',
      type: 'project',
      archivedAt: new Date('2026-07-01T00:00:00.000Z'),
    } as ObjectRow;
    const listObjects = vi.fn((filter: ObjectListFilter) =>
      Promise.resolve(filter.id?.includes(PROJECT_ID) ? [archivedProject] : []),
    );

    await expect(
      loadProjectFilterRows({
        listObjects,
        selected: PROJECT_ID,
        includeArchivedSelected: true,
      }),
    ).resolves.toEqual([archivedProject]);
    expect(listObjects).toHaveBeenCalledWith({
      id: [PROJECT_ID],
      type: 'project',
      limit: 1,
    });
  });
});
