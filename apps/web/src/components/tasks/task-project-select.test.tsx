// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  searchObjectsAction: vi.fn(),
  setTaskProjectAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/objects', () => ({
  searchObjectsAction: fakes.searchObjectsAction,
  setTaskProjectAction: fakes.setTaskProjectAction,
}));

const { TaskProjectSelect } = await import('./task-project-select.js');

describe('TaskProjectSelect', () => {
  beforeEach(() => {
    fakes.refresh.mockReset();
    fakes.searchObjectsAction.mockReset();
    fakes.searchObjectsAction.mockResolvedValue({ results: [] });
    fakes.setTaskProjectAction.mockReset();
  });

  afterEach(cleanup);

  it('keeps the selector pending until the project mutation settles', async () => {
    let resolveMutation: (value: { ok: true }) => void = () => undefined;
    fakes.setTaskProjectAction.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveMutation = resolve;
      }),
    );
    render(
      <TaskProjectSelect
        taskId="task-1"
        projectId={null}
        projects={[{ id: 'project-1', label: 'Faba website redesign' }]}
      />,
    );

    const selector = screen.getByRole('button', { name: 'Task project: No project' });
    await userEvent.click(selector);
    await userEvent.click(screen.getByRole('button', { name: 'Faba website redesign' }));

    expect((selector as HTMLButtonElement).disabled).toBe(true);
    expect(fakes.setTaskProjectAction).toHaveBeenCalledWith({
      id: 'task-1',
      projectId: 'project-1',
    });

    act(() => {
      resolveMutation({ ok: true });
    });
    await waitFor(() => {
      expect((selector as HTMLButtonElement).disabled).toBe(false);
    });
    expect(fakes.refresh).toHaveBeenCalledOnce();
  });

  it('exposes the selected project through the trigger and option semantics', async () => {
    render(
      <TaskProjectSelect
        taskId="task-1"
        projectId="project-1"
        currentProjectLabel="Faba website redesign"
        projects={[{ id: 'project-1', label: 'Faba website redesign' }]}
      />,
    );

    const selector = screen.getByRole('button', {
      name: 'Task project: Faba website redesign',
    });
    await userEvent.click(selector);

    expect(
      screen.getByRole('button', { name: 'Faba website redesign' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
