// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateObjectAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/objects', () => ({
  updateObjectAction: fakes.updateObjectAction,
}));

const { TaskBoard } = await import('./task-board.js');

function task(input: Partial<objects.ObjectRow> = {}): objects.ObjectRow {
  return {
    id: 'task-1',
    type: 'task',
    canonicalName: 'Send proposal',
    status: 'todo',
    stage: null,
    priority: 2,
    ownerUserId: null,
    assigneeUserId: 'user-1',
    dueAt: new Date('2026-07-04T00:00:00.000Z'),
    agentSuggested: false,
    archivedAt: null,
    aliases: [],
    metadata: {},
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    ...input,
  };
}

function renderBoard(
  selectedTaskId: string | null = null,
  rows: objects.ObjectRow[] = [task()],
  view: 'kanban' | 'list' = 'kanban',
) {
  return render(
    <TaskBoard
      rows={rows}
      columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
      selectedTaskId={selectedTaskId}
      view={view}
      members={[
        { id: 'user-1', label: 'Ada Lovelace' },
        { id: 'user-2', label: 'Grace Hopper' },
      ]}
    />,
  );
}

describe('TaskBoard', () => {
  beforeEach(() => {
    cleanup();
    fakes.refresh.mockReset();
    fakes.updateObjectAction.mockReset();
    fakes.updateObjectAction.mockResolvedValue({ ok: true });
  });

  it('opens a task side panel route from the card instead of object detail', () => {
    renderBoard();

    const link = screen.getByRole('link', { name: 'Send proposal' });

    expect(link.getAttribute('href')).toBe('/app/tasks?task=task-1');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Due 2026-07-04')).toBeTruthy();
    expect(screen.getByText('P2')).toBeTruthy();
  });

  it('prefers source-tracked integration display titles over provider identity canonical names', () => {
    render(
      <TaskBoard
        rows={[
          task({
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            metadata: {
              integration_provider: 'github',
              integration_external_id: 'timborovkov/the-timeline-ai#202',
              display_title: 'the-timeline-ai: Add cursor pagination',
              display_title_canonical_name:
                'timborovkov/the-timeline-ai#202: Add cursor pagination',
            },
          }),
        ]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId="task-1"
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );

    expect(screen.getAllByText('the-timeline-ai: Add cursor pagination')).toHaveLength(2);
    expect(screen.queryByText(/timborovkov\/the-timeline-ai#202/)).toBeNull();
  });

  it('uses provider identity canonical names when display metadata is absent', () => {
    render(
      <TaskBoard
        rows={[
          task({
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            metadata: {
              integration_provider: 'github',
              integration_external_id: 'timborovkov/the-timeline-ai#202',
            },
          }),
        ]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );

    expect(
      screen.getByRole('link', {
        name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('the-timeline-ai: Add cursor pagination')).toBeNull();
  });

  it('wraps long task titles on cards and in the selected panel', () => {
    const longTitle =
      'timborovkov/the-timeline-ai#202: Add cursor pagination to the visible tasks board so the title can be read';
    renderBoard('task-1', [task({ canonicalName: longTitle })]);

    const cardTitle = screen.getByRole('link', { name: longTitle });
    const panelTitle = screen.getByRole('heading', { name: longTitle });

    expect(cardTitle.className).toContain('break-words');
    expect(cardTitle.className).not.toContain('truncate');
    expect(panelTitle.className).toContain('break-words');
    expect(panelTitle.className).not.toContain('truncate');
  });

  it('renders the selected task panel with an object link that can return to the panel', () => {
    renderBoard('task-1');

    expect(screen.getByRole('complementary', { name: 'Task detail' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Close' }).getAttribute('href')).toBe('/app/tasks');
    expect(screen.getByRole('link', { name: 'Open object' }).getAttribute('href')).toBe(
      '/app/objects/task-1?returnTo=%2Fapp%2Ftasks%3Ftask%3Dtask-1',
    );
  });

  it('edits task assignee, due date, priority, and status from the panel', async () => {
    const user = userEvent.setup();
    renderBoard('task-1');

    await user.selectOptions(screen.getByLabelText('Task assignee'), 'user-2');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        assigneeUserId: 'user-2',
      });
    });

    await user.selectOptions(screen.getByLabelText('Task priority'), '3');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        priority: 3,
      });
    });

    await user.clear(screen.getByLabelText('Task due date'));
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        dueAt: null,
      });
    });

    await user.selectOptions(screen.getByDisplayValue('todo'), 'doing');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        status: 'doing',
      });
    });
  });

  it('switches to list view and preserves list mode when opening a task', () => {
    renderBoard(null, [task()], 'list');

    expect(screen.getByRole('link', { name: 'kanban' }).getAttribute('href')).toBe(
      '/app/tasks?view=kanban',
    );
    expect(screen.getByRole('link', { name: 'list' }).getAttribute('href')).toBe(
      '/app/tasks?view=list',
    );
    expect(screen.getByRole('link', { name: 'Send proposal' }).getAttribute('href')).toBe(
      '/app/tasks?view=list&task=task-1',
    );
    expect(screen.getByRole('checkbox', { name: 'Select Send proposal' })).toBeTruthy();
  });

  it('bulk assigns selected tasks from list view', async () => {
    const user = userEvent.setup();
    renderBoard(
      null,
      [
        task({ id: 'task-1', canonicalName: 'Send proposal' }),
        task({ id: 'task-2', canonicalName: 'Draft kickoff', assigneeUserId: null }),
      ],
      'list',
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Send proposal' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Draft kickoff' }));
    await user.selectOptions(screen.getByLabelText('Bulk assignee'), 'user-2');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        assigneeUserId: 'user-2',
      });
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-2',
        assigneeUserId: 'user-2',
      });
    });
  });

  it('keeps saved status patches visible until refreshed rows catch up', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TaskBoard
        rows={[task({ status: 'todo' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Status for Send proposal'), 'doing');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        status: 'doing',
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>('Status for Send proposal').value).toBe(
        'doing',
      );
    });

    rerender(
      <TaskBoard
        rows={[task({ status: 'doing' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>('Status for Send proposal').value).toBe(
        'doing',
      );
    });

    rerender(
      <TaskBoard
        rows={[task({ status: 'done' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );

    expect(screen.getByLabelText<HTMLSelectElement>('Status for Send proposal').value).toBe('done');
  });

  it('keeps the latest repeated status edit visible before refreshed rows arrive', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TaskBoard
        rows={[task({ status: 'todo' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Status for Send proposal'), 'doing');
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>('Status for Send proposal').value).toBe(
        'doing',
      );
    });

    await user.selectOptions(screen.getByLabelText('Status for Send proposal'), 'done');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        status: 'done',
      });
    });

    rerender(
      <TaskBoard
        rows={[task({ status: 'doing' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Status for Send proposal').value).toBe('done');

    rerender(
      <TaskBoard
        rows={[task({ status: 'done' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Status for Send proposal').value).toBe('done');
  });
});
