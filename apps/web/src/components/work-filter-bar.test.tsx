// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

  it('renders only the canonical cancelled status when both spellings are provided', async () => {
    const user = userEvent.setup();
    render(
      <WorkFilterBar
        mode="objects"
        basePath="/app/objects"
        filters={{ ...EMPTY_FILTERS, status: 'canceled,cancelled' }}
        active={false}
        resultCount={10}
        totalCount={10}
        statusOptions={['todo', 'cancelled', 'canceled']}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Status' }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'cancelled' })).toBeTruthy();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'canceled' })).toBeNull();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(push).toHaveBeenCalledWith('/app/objects?status=cancelled');
  });

  it('keeps date range controls collapsed until toggled, unless a range is active', async () => {
    const user = userEvent.setup();
    let view = render(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={EMPTY_FILTERS}
        active={false}
        resultCount={10}
        totalCount={10}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Date ranges' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Due from').closest('[hidden]')).toBeTruthy();

    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Due from').closest('[hidden]')).toBeNull();

    view.unmount();
    view = render(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={EMPTY_FILTERS}
        active={false}
        resultCount={10}
        totalCount={10}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Due' }), 'range');

    expect(screen.getByRole('button', { name: 'Date ranges' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByLabelText('Due from').closest('[hidden]')).toBeNull();

    view.unmount();
    view = render(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={{ ...EMPTY_FILTERS, due: 'range' }}
        active
        resultCount={1}
        totalCount={10}
      />,
    );

    expect(screen.getByRole('button', { name: 'Date ranges' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByLabelText('Due from').closest('[hidden]')).toBeNull();

    view.rerender(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={EMPTY_FILTERS}
        active={false}
        resultCount={10}
        totalCount={10}
      />,
    );

    expect(screen.getByRole('button', { name: 'Date ranges' }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    view.rerender(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={{ ...EMPTY_FILTERS, dueFrom: '2026-08-01' }}
        active
        resultCount={1}
        totalCount={10}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Date ranges' }).getAttribute('aria-expanded'),
      ).toBe('true');
    });
  });

  it('preserves hidden date range inputs when the range section is collapsed', async () => {
    const user = userEvent.setup();
    render(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={{ ...EMPTY_FILTERS, due: 'range', dueFrom: '2026-08-01', dueTo: '2026-08-05' }}
        active
        resultCount={2}
        totalCount={10}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Date ranges' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(push).toHaveBeenCalledWith('/app/tasks?due=range&dueFrom=2026-08-01&dueTo=2026-08-05');
  });

  it('reopens active date range controls when filter props change after a manual collapse', async () => {
    const user = userEvent.setup();
    const activeFilters = { ...EMPTY_FILTERS, dueFrom: '2026-08-01' };
    const view = render(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={activeFilters}
        active
        resultCount={2}
        totalCount={10}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Date ranges' }));

    expect(screen.getByRole('button', { name: 'Date ranges' }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    view.rerender(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={{ ...activeFilters }}
        active
        resultCount={2}
        totalCount={10}
      />,
    );

    expect(screen.getByRole('button', { name: 'Date ranges' }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    view.rerender(
      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={{ ...EMPTY_FILTERS, dueFrom: '2026-08-02' }}
        active
        resultCount={1}
        totalCount={10}
      />,
    );

    expect(screen.getByRole('button', { name: 'Date ranges' }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(push).toHaveBeenCalledWith('/app/tasks?dueFrom=2026-08-02');
  });
});
