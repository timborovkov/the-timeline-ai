import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@/app/actions/objects', () => ({ mergeObjectsAction: vi.fn() }));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => run(),
}));

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
  taskCategory: null,
  taskCategoryMode: null,
  taskCategorySource: null,
  taskCategoryStatus: null,
  taskCategoryUpdatedAt: null,
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

  it('renders foldable related facts for each merge candidate', () => {
    const html = renderToStaticMarkup(
      createElement(ObjectMergeForm, {
        objects: [
          { ...baseObject, id: 'object-a', canonicalName: 'Becca The Other Line' },
          { ...baseObject, id: 'object-b', canonicalName: 'Becca Builder' },
        ],
        initialSurvivorId: 'object-a',
        countsBySurvivorId: {
          'object-a': { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
          'object-b': { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
        },
        factSamplesByObjectId: {
          'object-a': [
            {
              id: 'fact-a',
              statement: 'Becca The Other Line owns payroll follow-up.',
              confidence: 0.91,
              rawEventId: 'event-a',
              extractedAt: new Date('2026-06-01T10:00:00.000Z'),
            },
          ],
          'object-b': [
            {
              id: 'fact-b',
              statement: 'Becca Builder works with vendor onboarding.',
              confidence: 0.84,
              rawEventId: 'event-b',
              extractedAt: new Date('2026-06-01T10:00:00.000Z'),
            },
          ],
        },
      }),
    );

    expect(html).toContain('Related facts (1)');
    expect(html).toContain('Becca The Other Line owns payroll follow-up.');
    expect(html).toContain('Becca Builder works with vendor onboarding.');
  });

  it('renders a direct reject button when reviewing a suggestion', () => {
    const html = renderToStaticMarkup(
      createElement(ObjectMergeForm, {
        objects: [
          { ...baseObject, id: 'object-a', canonicalName: 'Acme' },
          { ...baseObject, id: 'object-b', canonicalName: 'Beta' },
        ],
        initialSurvivorId: 'object-a',
        countsBySurvivorId: {
          'object-a': { facts: 0, notes: 0, relationships: 0, openTasks: 0 },
          'object-b': { facts: 0, notes: 0, relationships: 0, openTasks: 0 },
        },
        onReject: vi.fn(),
      }),
    );

    expect(html).toContain('Reject');
  });
});
