import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/boards', () => ({
  addBoardItemAction: vi.fn(),
  quickCreateBoardItemAction: vi.fn(),
}));

const { BoardAddItemForm } = await import('./board-add-item-form.js');

function objectRow(input: {
  id: string;
  canonicalName: string;
  type: objects.ObjectType;
  aliases?: string[];
}): objects.ObjectRow {
  return {
    id: input.id,
    canonicalName: input.canonicalName,
    type: input.type,
    aliases: input.aliases ?? [],
    status: 'open',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as objects.ObjectRow;
}

describe('BoardAddItemForm', () => {
  it('renders existing object search as an inline chooser instead of a native select', () => {
    const html = renderToStaticMarkup(
      createElement(BoardAddItemForm, {
        boardId: 'board-1',
        defaultLaneId: null,
        recommendedTypes: ['company'],
        candidates: [
          objectRow({
            id: 'object-1',
            canonicalName: 'MyAuditor',
            type: 'company',
            aliases: ['AuditAI'],
          }),
          objectRow({ id: 'object-2', canonicalName: 'Subcontracting', type: 'topic' }),
        ],
      }),
    );

    expect(html).toContain('Search existing objects');
    expect(html).toContain('Filter existing objects by type');
    expect(html).toContain('all');
    expect(html).toContain('company');
    expect(html).toContain('topic');
    expect(html).toContain('MyAuditor');
    expect(html).toContain('Subcontracting');
    expect(html).toContain('2 / 2');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Select object');
  });
});
