// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkQueueItem } from '@/lib/work-queue';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateObjectAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/objects', () => ({
  updateObjectAction: fakes.updateObjectAction,
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => {
    try {
      return await run();
    } catch {
      return { error: 'failed' };
    }
  },
}));

const { WorkQueueRow } = await import('./work-queue-row.js');

function item(input: Partial<WorkQueueItem> = {}): WorkQueueItem {
  return {
    id: 'object:task-1',
    entityId: 'task-1',
    href: '/app/objects/task-1',
    title: 'Technically run an audit end-to-end by mid-July',
    subtitle: '',
    source: 'object',
    sourceLabel: 'Task',
    objectType: 'task',
    status: 'doing',
    assigneeUserId: 'user-1',
    dueAt: new Date('2026-07-16T00:00:00.000Z'),
    priority: 2,
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    reasons: ['owned_by_you'],
    ...input,
  };
}

describe('WorkQueueRow', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fakes.updateObjectAction.mockResolvedValue({ ok: true });
  });

  it('shows type once through status rather than repeating Task labels', () => {
    render(
      <WorkQueueRow item={item()} members={[{ id: 'user-1', label: 'Ada' }]} timezone="UTC" />,
    );

    expect(screen.queryAllByText('Task')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Status for/ }).textContent).toContain('In progress');
    expect(screen.getByRole('button', { name: /Assignee for/ }).textContent).toContain('Ada');
    expect(screen.getByText('Owned by you')).toBeTruthy();
  });

  it('saves status, assignee, and due date inline', async () => {
    const user = userEvent.setup();
    render(
      <WorkQueueRow
        item={item()}
        members={[
          { id: 'user-1', label: 'Ada' },
          { id: 'user-2', label: 'Tim' },
        ]}
        timezone="UTC"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Status for/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'blocked');
    expect(fakes.updateObjectAction).toHaveBeenCalledWith({
      id: 'task-1',
      status: 'blocked',
    });

    await user.click(screen.getByRole('button', { name: /Assignee for/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'user-2');
    expect(fakes.updateObjectAction).toHaveBeenCalledWith({
      id: 'task-1',
      assigneeUserId: 'user-2',
    });
  });

  it('does not expose field editors on approval rows', () => {
    render(
      <WorkQueueRow
        item={item({
          id: 'approvals',
          entityId: undefined,
          href: '/app/approvals?status=pending',
          title: '3 pending approvals',
          subtitle: 'Agent proposals waiting for review',
          source: 'approval',
          sourceLabel: 'Approvals',
          objectType: undefined,
          status: undefined,
          reasons: ['pending_approval'],
        })}
        members={[]}
        timezone="UTC"
      />,
    );

    expect(screen.queryByRole('button', { name: /Status for/ })).toBeNull();
    expect(screen.getByText('Approvals')).toBeTruthy();
  });

  it('rolls a failed inline edit back onto the row', async () => {
    const user = userEvent.setup();
    fakes.updateObjectAction.mockResolvedValueOnce({ error: 'Connection lost' });
    render(
      <WorkQueueRow
        item={item({ priority: null })}
        members={[{ id: 'user-1', label: 'Ada' }]}
        timezone="UTC"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Priority for/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), '1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Priority for/ }).textContent).toContain(
        'No priority',
      );
    });
  });
});
