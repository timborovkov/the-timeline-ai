import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
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
    completeFirstRunAction: vi.fn(() => Promise.resolve({ ok: true })),
    goToOnboardingHomeAction: vi.fn(),
    recordAgentDeployedAction: fakes.recordAgentDeployedAction,
  }),
  () => import('@/app/actions/first-run'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/teams'),
  () => ({ updateDigestPreferenceAction: vi.fn(() => Promise.resolve({ ok: true })) }),
  () => import('@/app/actions/teams'),
);

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { GoLiveScreen } = await import('./go-live-screen.js');

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
