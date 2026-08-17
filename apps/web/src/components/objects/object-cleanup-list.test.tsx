// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  confirm: vi.fn(),
  bulkArchiveObjectsAction: vi.fn(),
  updateObjectAction: vi.fn(),
  notifyAction: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/components/ui/app-dialog', () => ({
  useAppDialog: () => ({ confirm: fakes.confirm }),
}));
vi.mock('@/app/actions/objects', () => ({
  bulkArchiveObjectsAction: fakes.bulkArchiveObjectsAction,
  updateObjectAction: fakes.updateObjectAction,
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: (options: { run: () => Promise<{ error?: string }> }) =>
    fakes.notifyAction(options),
  notifyError: fakes.notifyError,
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
    fakes.updateObjectAction.mockResolvedValue({ ok: true });
    fakes.notifyAction.mockImplementation(async ({ run }: { run: () => Promise<{ error?: string }> }) =>
      run(),
    );
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

  it('does not expose a disabled merge action as a keyboard-activatable link', async () => {
    const user = userEvent.setup();
    render(
      <ObjectCleanupList
        rows={[
          object({ id: 'object-1', canonicalName: 'First object' }),
          object({ id: 'object-2', canonicalName: 'Second object' }),
        ]}
        typeLabels={{ task: 'Task' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(screen.queryByRole('link', { name: 'Merge' })).toBeNull();
    expect(screen.queryByText('Merge')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Select First object' }));
    expect(screen.getByRole('status').textContent).toBe('1 object selected');
    expect(screen.getByText('Merge').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('link', { name: 'Merge' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Select Second object' }));
    expect(screen.getByRole('status').textContent).toBe('2 objects selected');
    expect(screen.getByRole('link', { name: 'Merge' }).getAttribute('href')).toContain(
      '/app/objects/merge?ids=object-1%2Cobject-2',
    );
  });

  it('edits displayed metadata optimistically from quiet row triggers', async () => {
    const user = userEvent.setup();
    render(<ObjectCleanupList rows={[object()]} typeLabels={{ task: 'Task' }} />);

    await user.click(
      screen.getByRole('button', { name: 'Status for Legacy suggested cleanup row' }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'doing');

    expect(fakes.updateObjectAction).toHaveBeenCalledWith({
      id: 'object-1',
      status: 'doing',
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Status for Legacy suggested cleanup row' }).textContent,
      ).toContain('In progress');
    });
  });

  it('rolls failed metadata edits back and reports the row error', async () => {
    const user = userEvent.setup();
    fakes.updateObjectAction.mockResolvedValueOnce({ error: 'Connection lost' });
    render(<ObjectCleanupList rows={[object()]} typeLabels={{ task: 'Task' }} />);

    await user.click(
      screen.getByRole('button', { name: 'Priority for Legacy suggested cleanup row' }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), '1');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Priority for Legacy suggested cleanup row' })
          .textContent,
      ).toContain('No priority');
      expect(fakes.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Couldn’t update priority',
        }),
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
