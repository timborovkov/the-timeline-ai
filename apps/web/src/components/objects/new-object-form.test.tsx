// @vitest-environment happy-dom

/** Business intent: task creation can find any active project, not only the server preload. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  createObjectAction: vi.fn(),
  push: vi.fn(),
  setQuery: vi.fn(),
  query: 'Legacy',
  projects: [{ id: 'project-remote', label: 'Legacy client migration' }],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fakes.push }) }));
vi.mock('@/app/actions/objects', () => ({ createObjectAction: fakes.createObjectAction }));
vi.mock('@/hooks/use-project-search', () => ({
  useProjectSearch: () => ({
    query: fakes.query,
    setQuery: fakes.setQuery,
    projects: fakes.projects,
  }),
}));

const { NewObjectForm } = await import('./new-object-form.js');

beforeEach(() => {
  fakes.query = 'Legacy';
  fakes.projects = [{ id: 'project-remote', label: 'Legacy client migration' }];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NewObjectForm', () => {
  it('includes remotely searched projects outside the preload', () => {
    render(<NewObjectForm projects={[{ id: 'project-preloaded', label: 'Recent project' }]} />);

    expect(screen.getByRole('searchbox', { name: 'Search task projects' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Legacy client migration' })).toBeTruthy();
  });

  it('keeps a remotely selected project visible after search is cleared', () => {
    const view = render(
      <NewObjectForm projects={[{ id: 'project-preloaded', label: 'Recent project' }]} />,
    );
    const selector = screen.getByRole('combobox', { name: 'Task project' });
    fireEvent.change(selector, { target: { value: 'project-remote' } });

    fakes.query = '';
    fakes.projects = [];
    view.rerender(
      <NewObjectForm projects={[{ id: 'project-preloaded', label: 'Recent project' }]} />,
    );

    expect((selector as HTMLSelectElement).value).toBe('project-remote');
    expect(screen.getByRole('option', { name: 'Legacy client migration' })).toBeTruthy();
  });

  it('shows due status only for schedulable object types', () => {
    render(<NewObjectForm />);

    expect(screen.getByText('No due date')).toBeTruthy();
    expect(screen.getByLabelText('Due date')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Object type' }), {
      target: { value: 'person' },
    });
    expect(screen.queryByText('No due date')).toBeNull();
    expect(screen.queryByLabelText('Due date')).toBeNull();
  });
});
