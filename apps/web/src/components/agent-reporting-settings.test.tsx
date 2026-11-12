import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';
// Test environment: happy-dom

const save = vi.fn(
  (_previous: unknown, _data: FormData): Promise<{ saved?: boolean; error?: string }> =>
    Promise.resolve({ saved: true }),
);
await vi.mock(
  import.meta.resolve('@/app/actions/agent-reporting'),
  () => ({ updateAgentReportingAction: save }),
  () => import('@/app/actions/agent-reporting'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  () => ({ notifyAction: async ({ run }: { run: () => Promise<unknown> }) => run() }),
  () => import('@/lib/notify'),
);

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { AgentReportingSettings } = await import('./agent-reporting-settings');
const defaults = { mode: 'on_request' as const, scope: '', revision: '0' };

afterEach(() => {
  cleanup();
  save.mockClear();
});

it('requires scope only for ongoing reporting and submits the selected agreement', async () => {
  render(<AgentReportingSettings teamId="team" defaults={defaults} connections={[]} />);
  expect(screen.queryByLabelText('Project or work scope')).toBeNull();
  fireEvent.change(screen.getByLabelText('When to report'), { target: { value: 'handoffs' } });
  const scope = screen.getByLabelText('Project or work scope');
  expect(scope.hasAttribute('required')).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save preference' }).disabled).toBe(
    true,
  );
  fireEvent.change(scope, { target: { value: 'Website launch' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save preference' }));
  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });
  const data = save.mock.calls[0]?.[1];
  if (!data) throw new Error('Expected submitted form data');
  expect(data.get('mode')).toBe('handoffs');
  expect(data.get('scope')).toBe('Website launch');
  expect(data.get('type')).toBe('workspace');
  const form = scope.closest('form');
  if (!form) throw new Error('Expected reporting form');
  expect(fireEvent.reset(form)).toBe(false);
});

it('keeps connection overrides collapsed and preserves inheritance', () => {
  render(
    <AgentReportingSettings
      teamId="team"
      defaults={defaults}
      connections={[
        { id: 'grant', name: 'Claude Code', description: 'Alex', type: 'oauth', preference: null },
      ]}
    />,
  );
  const name = screen.getByText('Claude Code');
  expect(name.closest('details')?.open).toBe(false);
  const details = name.closest('details');
  const select = details?.querySelector('select');
  if (!details || !select) throw new Error('Expected connection settings');
  expect(select.value).toBe('inherit');
  expect(screen.queryByText('grant')).toBeNull();
  fireEvent.change(select, { target: { value: 'handoffs' } });
  expect(details.querySelector('input[name="scope"]')?.hasAttribute('required')).toBe(true);
  fireEvent.change(select, { target: { value: 'inherit' } });
  expect(details.querySelector('input[name="scope"]')?.getAttribute('type')).toBe('hidden');
});

it('keeps a failed save actionable with an inline error', async () => {
  save.mockResolvedValueOnce({ error: 'Could not save. Try again.' });
  render(<AgentReportingSettings teamId="team" defaults={defaults} connections={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save preference' }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('Could not save. Try again.');
  });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save preference' }).disabled).toBe(
    false,
  );
});
