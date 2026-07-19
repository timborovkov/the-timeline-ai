import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PinnedBoards } from '@/components/boards/pinned-boards';

describe('PinnedBoards', () => {
  it('uses concise dashboard copy', () => {
    const html = renderToStaticMarkup(
      <PinnedBoards
        boards={[
          {
            id: 'board-1',
            name: 'Pilot pipeline',
            purpose: 'Track pilots',
            templateKind: 'pipeline',
            recommendedObjectTypes: ['deal'],
            strictObjectTypes: false,
            candidateFilter: {},
            isShared: true,
            archivedAt: null,
            createdBy: 'user-1',
            createdAt: new Date('2026-06-14T00:00:00Z'),
            updatedAt: new Date('2026-06-14T00:00:00Z'),
            itemCount: 7,
            laneCounts: [
              { laneId: 'lane-1', laneName: 'New', count: 3 },
              { laneId: 'lane-2', laneName: 'Won', count: 1 },
            ],
            dueSoonCount: 2,
            overdueCount: 1,
            pinned: true,
          },
        ]}
      />,
    );

    expect(html).toContain('Pinned work');
    expect(html).toContain('New:');
    expect(html).toContain('>3</span>');
    expect(html).toContain('>1</span> overdue');
    expect(html).toContain('>2</span> due soon');
    expect(html).not.toContain('Pinned boards</h2>');
  });
});
