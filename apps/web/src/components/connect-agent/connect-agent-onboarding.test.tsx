import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  useOnboardingChecklistQuery: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/use-paginated-queries'),
  () => ({
    useOnboardingChecklistQuery: fakes.useOnboardingChecklistQuery,
  }),
  () => import('@/lib/use-paginated-queries'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyError: vi.fn(),
  }),
  () => import('@/lib/notify'),
);

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { ConnectAgentOnboardingCard } = await import('./connect-agent-onboarding.js');

afterEach(() => {
  cleanup();
});

describe('ConnectAgentOnboardingCard', () => {
  it('explains remember vs answers and skips by completing the step', () => {
    const mutateChecklist = vi.fn();
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      data: {
        dismissed: true,
        items: [{ key: 'connect_agent', label: 'Connect your agent', completed: false }],
      },
      isPending: false,
      checklistLoadFailed: false,
      mutateChecklist,
      checklistPending: false,
      checklistMutationFailed: false,
      retryChecklistMutation: vi.fn(),
    });

    render(<ConnectAgentOnboardingCard />);

    expect(screen.getByRole('heading', { name: 'Connect your agent' })).toBeTruthy();
    expect(screen.getByText(/Answers appear once work is captured/)).toBeTruthy();
    expect(screen.getByText(/Remember works now/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect your agent' }).getAttribute('href')).toBe(
      '/app/connect-agent',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Skip connect your agent' }));
    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'complete', key: 'connect_agent' });
  });

  it('does not return once the step is complete, even if the checklist is dismissed', () => {
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      data: {
        dismissed: false,
        items: [{ key: 'connect_agent', label: 'Connect your agent', completed: true }],
      },
      isPending: false,
      checklistLoadFailed: false,
      mutateChecklist: vi.fn(),
      checklistPending: false,
      checklistMutationFailed: false,
      retryChecklistMutation: vi.fn(),
    });

    const { container } = render(<ConnectAgentOnboardingCard />);
    expect(container.textContent).toBe('');
  });
});
