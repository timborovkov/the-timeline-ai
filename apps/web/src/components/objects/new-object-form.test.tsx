// @vitest-environment happy-dom

/** Business intent: task creation can find any active project, not only the server preload. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  createObjectAction: vi.fn(),
  push: vi.fn(),
  setQuery: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fakes.push }) }));
vi.mock('@/app/actions/objects', () => ({ createObjectAction: fakes.createObjectAction }));
vi.mock('@/hooks/use-project-search', () => ({
  useProjectSearch: () => ({
    query: 'Legacy',
    setQuery: fakes.setQuery,
    projects: [{ id: 'project-remote', label: 'Legacy client migration' }],
  }),
}));

const { NewObjectForm } = await import('./new-object-form.js');

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
});
