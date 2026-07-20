// @vitest-environment happy-dom

/** Business intent: task creation can find any active project, not only the server preload. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('includes remotely searched projects outside the preload', async () => {
    render(<NewObjectForm projects={[{ id: 'project-preloaded', label: 'Recent project' }]} />);

    await userEvent.click(screen.getByRole('button', { name: /^Task project:/ }));
    expect(screen.getByRole('searchbox', { name: 'Search task projects' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Legacy client migration' })).toBeTruthy();
  });

  it('keeps a remotely selected project visible after search is cleared', async () => {
    const view = render(
      <NewObjectForm projects={[{ id: 'project-preloaded', label: 'Recent project' }]} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Task project:/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Legacy client migration' }));

    fakes.query = '';
    fakes.projects = [];
    view.rerender(
      <NewObjectForm projects={[{ id: 'project-preloaded', label: 'Recent project' }]} />,
    );

    expect(screen.getByRole('button', { name: /^Task project:/ }).textContent).toContain(
      'Legacy client migration',
    );
  });
});
