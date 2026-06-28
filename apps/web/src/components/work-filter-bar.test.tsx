// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkFilterState } from '@/lib/work-filters';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const { WorkFilterBar } = await import('./work-filter-bar.js');

const EMPTY_FILTERS: WorkFilterState = {
  q: '',
  type: '',
  status: '',
  stage: '',
  owner: '',
  assignee: '',
  responsible: '',
  lane: '',
  priority: '',
  due: '',
  dueFrom: '',
  dueTo: '',
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
};

describe('WorkFilterBar', () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
  });

  it('preserves hidden params on apply unless an empty form control clears them', async () => {
    const user = userEvent.setup();
    render(
      <WorkFilterBar
        mode="objects"
        basePath="/app/objects"
        filters={{ ...EMPTY_FILTERS, type: 'task' }}
        active
        resultCount={1}
        totalCount={1}
        hiddenParams={{ type: 'task' }}
        typeLabels={{ task: 'Tasks' }}
      />,
    );

    await user.type(screen.getByLabelText('Search'), 'proposal');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(push).toHaveBeenCalledWith('/app/objects?type=task&q=proposal');

    await user.click(screen.getByRole('button', { name: 'Type' }));
    await user.click(screen.getByRole('menuitem', { name: 'Any type' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(push).toHaveBeenLastCalledWith('/app/objects?q=proposal');
  });

  it('submits multiple dropdown values as comma-separated filters', async () => {
    const user = userEvent.setup();
    render(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={EMPTY_FILTERS}
        active={false}
        resultCount={10}
        totalCount={10}
        statusOptions={['todo', 'doing', 'done']}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'todo' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'doing' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(push).toHaveBeenCalledWith('/app/tasks?status=todo%2Cdoing');
  });
});
