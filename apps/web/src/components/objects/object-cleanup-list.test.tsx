// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  confirm: vi.fn(),
  bulkArchiveObjectsAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/components/ui/app-dialog', () => ({
  useAppDialog: () => ({ confirm: fakes.confirm }),
}));
vi.mock('@/app/actions/objects', () => ({
  bulkArchiveObjectsAction: fakes.bulkArchiveObjectsAction,
}));

const { ObjectCleanupList } = await import('./object-cleanup-list.js');

function object(input: Partial<objects.ObjectRow> = {}): objects.ObjectRow {
  return {
    id: 'object-1',
    type: 'task',
    canonicalName: 'Legacy suggested cleanup row',
    status: 'suggested',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: true,
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
    archivedAt: null,
    aliases: [],
    metadata: {},
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    ...input,
  };
}

describe('ObjectCleanupList', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fakes.confirm.mockResolvedValue(false);
    fakes.bulkArchiveObjectsAction.mockResolvedValue({ ok: true });
  });

  it('does not render legacy agentSuggested badges on object rows', () => {
    render(<ObjectCleanupList rows={[object()]} typeLabels={{ task: 'Task' }} />);

    expect(screen.getByRole('link', { name: 'Legacy suggested cleanup row' })).toBeTruthy();
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.queryByText('Suggested', { selector: '.text-signal' })).toBeNull();
  });

  it('shows missing due state only for schedulable objects', () => {
    render(
      <ObjectCleanupList
        rows={[
          object({ id: 'task-1', canonicalName: 'Task without date' }),
          object({ id: 'person-1', type: 'person', canonicalName: 'Person record' }),
        ]}
        typeLabels={{ task: 'Task', person: 'People' }}
      />,
    );

    expect(screen.getAllByText('No due date')).toHaveLength(1);
  });
});
