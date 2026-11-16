import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
  workStyle: vi.fn(() => Promise.resolve({ ok: true })),
  phase: vi.fn(() => Promise.resolve({ ok: true })),
  digestSave: vi.fn(() => Promise.resolve({ ok: true } as { ok?: boolean; error?: string })),
  finish: vi.fn(() => Promise.resolve({ ok: true } as { ok?: boolean; error?: string })),
  recordAgentDeployedAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({
    useRouter: () => ({ push: fakes.push, replace: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/first-run'),
  () => ({
    completeFirstRunAction: fakes.finish,
    updateWorkStylePreferenceAction: fakes.workStyle,
    setFirstRunPhaseAction: fakes.phase,
    goToOnboardingHomeAction: vi.fn(),
    recordAgentDeployedAction: fakes.recordAgentDeployedAction,
  }),
  () => import('@/app/actions/first-run'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/teams'),
  () => ({ updateDigestPreferenceAction: fakes.digestSave }),
  () => import('@/app/actions/teams'),
);

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { GoLiveScreen } = await import('./go-live-screen.js');
const { WorkStylePreference } = await import('./work-style-preference.js');
const { GuidedContinue } = await import('./guided-continue.js');

afterEach(() => {
  cleanup();
});

describe('GoLiveScreen', () => {
  it('recommends email forwarding for email-first teams and never claims a Gmail connection', () => {
    render(
      <GoLiveScreen
        workStyle="email"
        inboundEmail="northwind-studio@inbound.test"
        digestEnabled={false}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Keep it updating itself' })).toBeTruthy();
    expect(screen.getByText('Recommended for how you work')).toBeTruthy();
    expect(screen.getByText(/This is not a Gmail connection/)).toBeTruthy();
    expect(screen.queryByDisplayValue('northwind-studio@inbound.test')).toBeNull();
    expect(screen.getByRole('button', { name: 'Go to Home' })).toBeTruthy();
  });

  it('does not count Slack as deployed until OAuth succeeds', () => {
    render(
      <GoLiveScreen workStyle="chat" inboundEmail="team@inbound.test" digestEnabled={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install Slack' }));
    expect(fakes.push).toHaveBeenCalledWith('/api/slack/install/start');
    expect(fakes.recordAgentDeployedAction).not.toHaveBeenCalled();
  });
});

it('restores the saved digest preference after a failed save', async () => {
  fakes.digestSave.mockResolvedValueOnce({ error: 'Could not save digest preference.' });
  fakes.recordAgentDeployedAction.mockClear();
  render(<GoLiveScreen workStyle="email" inboundEmail="team@inbound.test" digestEnabled={false} />);
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => {
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });
  expect(fakes.recordAgentDeployedAction).not.toHaveBeenCalled();
});

it('does not navigate when setup completion fails', async () => {
  fakes.finish.mockResolvedValueOnce({ error: 'Could not finish setup.' });
  fakes.push.mockClear();
  render(<GoLiveScreen workStyle="email" inboundEmail="team@inbound.test" digestEnabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Go to Home' }).hasAttribute('disabled')).toBe(false);
  });
  expect(fakes.push).not.toHaveBeenCalled();
});

it('rolls back a rejected work-style save and exposes retryable failure', async () => {
  fakes.workStyle.mockRejectedValueOnce(new Error('Offline'));
  render(<WorkStylePreference initialWorkStyle={null} />);
  const option = screen.getAllByRole('button')[0] as HTMLButtonElement;
  fireEvent.click(option);
  await screen.findByRole('alert');
  expect(option.getAttribute('aria-pressed')).toBe('false');
  expect(option.disabled).toBe(false);
});

it('keeps guided navigation on its current step when saving rejects', async () => {
  fakes.phase.mockRejectedValueOnce(new Error('Offline'));
  fakes.push.mockClear();
  render(<GuidedContinue phase="ask" href="/app/ask" label="Continue" />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false);
  });
  expect(fakes.push).not.toHaveBeenCalled();
});
