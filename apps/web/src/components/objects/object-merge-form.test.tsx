import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects';

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@/app/actions/objects', () => ({ mergeObjectsAction: vi.fn() }));

const { ObjectMergeForm } = await import('./object-merge-form.js');

const baseObject = {
  type: 'company',
  aliases: [],
  metadata: {},
  status: 'active',
  stage: null,
  priority: null,
  ownerUserId: null,
  assigneeUserId: null,
  dueAt: null,
  agentSuggested: false,
  archivedAt: null,
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
} satisfies Omit<objects.ObjectRow, 'id' | 'canonicalName'>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ObjectMergeForm', () => {
  it('renders preview counts for the selected initial survivor', () => {
    const html = renderToStaticMarkup(
      createElement(ObjectMergeForm, {
        objects: [
          { ...baseObject, id: 'object-a', canonicalName: 'Acme' },
          { ...baseObject, id: 'object-b', canonicalName: 'Beta' },
        ],
        initialSurvivorId: 'object-b',
        countsBySurvivorId: {
          'object-a': { facts: 11, notes: 12, relationships: 13, openTasks: 14 },
          'object-b': { facts: 41, notes: 42, relationships: 43, openTasks: 44 },
        },
      }),
    );

    expect(html).toContain('Beta');
    expect(html).toContain('Keep');
    expect(html).toContain('>41</div>');
    expect(html).toContain('>42</div>');
    expect(html).toContain('>43</div>');
    expect(html).toContain('>44</div>');
    expect(html).not.toContain('>11</div>');
  });
});
