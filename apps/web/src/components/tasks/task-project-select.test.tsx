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

    expect(screen.getByRole('status').textContent).toBe(
      '1 project shown. Search to find other projects.',
    );
    expect(
      screen.getByRole('button', { name: 'Faba website redesign' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('announces a failed remote search and lets the user retry it', async () => {
    fakes.searchObjectsAction.mockRejectedValueOnce(new Error('search unavailable'));
    fakes.searchObjectsAction.mockResolvedValueOnce({
      results: [
        {
          id: 'project-1',
          type: 'project',
          canonicalName: 'Faba website redesign',
        },
      ],
    });
    render(<TaskProjectSelect taskId="task-1" projectId={null} projects={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Task project: No project' }));
    const search = screen.getByRole('searchbox', { name: 'Search task projects' });
    await userEvent.type(search, 'Fa');

    expect(screen.getByRole('status').textContent).toBe('Searching projects…');
    await screen.findByRole('alert');
    expect(screen.getByRole('status').textContent).toBe('Project search failed.');

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('status').textContent).toBe('Searching projects…');
    expect(await screen.findByRole('button', { name: 'Faba website redesign' })).toBeTruthy();
  });

  it('announces when a remote search has no matching projects', async () => {
    render(<TaskProjectSelect taskId="task-1" projectId={null} projects={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Task project: No project' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search task projects' }), 'Fa');

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('No matching projects.');
    });
  });

  it('does not count a preserved selected project as a search match', async () => {
    render(
      <TaskProjectSelect
        taskId="task-1"
        projectId="project-1"
        currentProjectLabel="Alpha launch"
        projects={[{ id: 'project-1', label: 'Alpha launch' }]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Task project: Alpha launch' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search task projects' }), 'zz');

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('No matching projects.');
    });
    expect(screen.getByRole('button', { name: 'Alpha launch' })).toBeTruthy();
  });

  it('links a failed project update to the selector and keeps focus on it', async () => {
    fakes.setTaskProjectAction.mockResolvedValue({ error: 'Project update failed' });
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

    const error = await screen.findByRole('alert');
    expect(selector.getAttribute('aria-describedby')).toBe(error.id);
    await waitFor(() => {
      expect((selector as HTMLButtonElement).disabled).toBe(false);
      expect(document.activeElement).toBe(selector);
    });
  });
});
