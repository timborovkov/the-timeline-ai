import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type { ReactNode } from 'react';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getObjectMergePreview: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
    useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      objects: { getObjectMergePreview: fakes.getObjectMergePreview },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/components/objects/object-merge-form'),
  () => ({
    ObjectMergeForm: ({
      factSamplesByObjectId,
    }: {
      factSamplesByObjectId: Record<string, { statement: string }[]>;
    }) => (
      <div data-testid="object-merge-form">
        {Object.values(factSamplesByObjectId)
          .flat()
          .map((fact) => fact.statement)
          .join(',')}
      </div>
    ),
  }),
  () => import('@/components/objects/object-merge-form'),
);
await vi.mock(
  import.meta.resolve('@/components/objects/object-merge-route-modal'),
  () => ({
    ObjectMergeRouteModalForm: () => <div data-testid="object-merge-modal-form" />,
    ObjectMergeRouteModalFrame: ({ children }: { children: ReactNode }) => (
      <div data-testid="object-merge-modal-frame">{children}</div>
    ),
  }),
  () => import('@/components/objects/object-merge-route-modal'),
);
await vi.mock(
  import.meta.resolve('@/components/history-back-link'),
  () => ({
    HistoryBackLink: ({ label }: { label: string }) => <a href="/app/objects">{label}</a>,
  }),
  () => import('@/components/history-back-link'),
);

const { renderToStaticMarkup } = await import('react-dom/server');

const { default: MergeObjectsPage } = await import('./page.js');

const survivorId = '00000000-0000-4000-8000-000000000001';
const duplicateId = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.getObjectMergePreview.mockResolvedValue({
    objects: [
      {
        id: survivorId,
        canonicalName: 'Becca The Other Line',
        type: 'person',
        aliases: [],
        metadata: {},
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
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      },
      {
        id: duplicateId,
        canonicalName: 'Becca Builder',
        type: 'person',
        aliases: [],
        metadata: {},
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
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      },
    ],
    survivorId,
    aliasesToAdd: [],
    factSamplesByObjectId: {
      [survivorId]: [
        {
          id: 'fact-a',
          statement: 'Becca The Other Line owns payroll follow-up.',
          confidence: 0.91,
          rawEventId: 'event-a',
          extractedAt: new Date('2026-06-01T10:00:00.000Z'),
        },
      ],
      [duplicateId]: [
        {
          id: 'fact-b',
          statement: 'Becca Builder works with vendor onboarding.',
          confidence: 0.84,
          rawEventId: 'event-b',
          extractedAt: new Date('2026-06-01T10:00:00.000Z'),
        },
      ],
    },
    counts: { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
    countsBySurvivorId: {
      [survivorId]: { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
      [duplicateId]: { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
    },
  });
});

describe('MergeObjectsPage', () => {
  it('passes related fact samples into the standalone merge form', async () => {
    const html = renderToStaticMarkup(
      await MergeObjectsPage({
        searchParams: Promise.resolve({ ids: `${survivorId},${duplicateId}` }),
      }),
    );

    expect(html).toContain('Becca The Other Line owns payroll follow-up.');
    expect(html).toContain('Becca Builder works with vendor onboarding.');
    expect(html).toContain('aria-label="Work"');
    expect(html).toContain('aria-current="page"');
  });
});
