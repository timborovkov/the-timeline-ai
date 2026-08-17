// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TaskViewToggle } from '@/components/tasks/task-view-toggle';

afterEach(() => {
  cleanup();
});

describe('TaskViewToggle', () => {
  it('preserves the selected task and current filters when switching views', () => {
    render(
      <TaskViewToggle
        view="list"
        selectedTaskId="task-1"
        filterParams={{ assignee: 'user-1', due: 'next7', q: 'proposal' }}
      />,
    );

    expect(screen.getByRole('link', { name: 'kanban' }).getAttribute('href')).toBe(
      '/app/tasks?assignee=user-1&due=next7&q=proposal&view=kanban&task=task-1',
    );
    expect(screen.getByRole('link', { name: 'list' }).getAttribute('href')).toBe(
      '/app/tasks?assignee=user-1&due=next7&q=proposal&view=list&task=task-1',
    );
  });

  it('omits the task param when nothing is selected', () => {
    render(<TaskViewToggle view="list" selectedTaskId={null} />);

    expect(screen.getByRole('link', { name: 'kanban' }).getAttribute('href')).toBe(
      '/app/tasks?view=kanban',
    );
    expect(screen.getByRole('link', { name: 'list' }).getAttribute('href')).toBe(
      '/app/tasks?view=list',
    );
  });
});
