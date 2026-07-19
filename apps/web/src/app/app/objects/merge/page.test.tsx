import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getObjectMergePreview: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: { getObjectMergePreview: fakes.getObjectMergePreview },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/objects/object-merge-form', () => ({
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
}));
vi.mock('@/components/objects/object-merge-route-modal', () => ({
  ObjectMergeRouteModalForm: () => <div data-testid="object-merge-modal-form" />,
  ObjectMergeRouteModalFrame: ({ children }: { children: ReactNode }) => (
    <div data-testid="object-merge-modal-frame">{children}</div>
  ),
}));
vi.mock('@/components/history-back-link', () => ({
  HistoryBackLink: ({ label }: { label: string }) => <a href="/app/objects">{label}</a>,
}));

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
