import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

/** Business intent: task creation can find any active project, not only the server preload. */

const fakes = vi.hoisted(() => ({
  createObjectAction: vi.fn(),
  push: vi.fn(),
  setQuery: vi.fn(),
  query: 'Legacy',
  projects: [{ id: 'project-remote', label: 'Legacy client migration' }],
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ push: fakes.push }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/objects'),
  () => ({ createObjectAction: fakes.createObjectAction }),
  () => import('@/app/actions/objects'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyAction: async ({ run }: { run: () => Promise<{ error?: string; id?: string }> }) => run(),
  }),
  () => import('@/lib/notify'),
);
await vi.mock(
  import.meta.resolve('@/hooks/use-project-search'),
  () => ({
    useProjectSearch: () => ({
      query: fakes.query,
      setQuery: fakes.setQuery,
      projects: fakes.projects,
    }),
  }),
  () => import('@/hooks/use-project-search'),
);

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

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

  it('shows due status only for schedulable object types', () => {
    render(<NewObjectForm />);

    expect(screen.getByText('No due date')).toBeTruthy();
    expect(screen.getByLabelText(/Due date/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Object type' }), {
      target: { value: 'person' },
    });
    expect(screen.queryByText('No due date')).toBeNull();
    expect(screen.queryByLabelText(/Due date/)).toBeNull();
  });

  it('keeps the primary submit available and focuses the invalid name field', async () => {
    render(<NewObjectForm />);

    const createObject = screen.getByRole('button', { name: 'Create object' });
    expect(createObject.hasAttribute('disabled')).toBe(false);

    await userEvent.click(createObject);

    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe('object-name-error');
    expect(screen.getByRole('alert').textContent).toBe('Enter an object name.');
    expect(fakes.createObjectAction).not.toHaveBeenCalled();
  });

  it('submits through Enter and routes after a successful creation', async () => {
    fakes.createObjectAction.mockResolvedValue({ ok: true, id: 'object-1' });
    render(<NewObjectForm />);

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Follow up{Enter}');

    await waitFor(() => {
      expect(fakes.createObjectAction).toHaveBeenCalledWith({
        type: 'task',
        canonicalName: 'Follow up',
      });
    });
    expect(fakes.push).toHaveBeenCalledWith('/app/objects/object-1');
  });
});
