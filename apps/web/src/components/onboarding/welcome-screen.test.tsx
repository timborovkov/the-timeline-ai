import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const { act, cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { WelcomeScreen } = await import('./welcome-screen.js');

afterEach(() => {
  cleanup();
});

describe('WelcomeScreen', () => {
  it('asks how the team works, not how large it is, and uses the inbound address from props', async () => {
    const user = userEvent.setup();
    const onContinue = () => Promise.resolve();
    render(
      <WelcomeScreen
        teamName="Northwind Studio"
        inboundEmail="northwind-studio@inbound.test"
        initialWorkStyle={null}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Your team is ready' })).toBeTruthy();
    expect(screen.getByDisplayValue('northwind-studio@inbound.test')).toBeTruthy();
    expect(screen.getByText('How does your team mostly work?')).toBeTruthy();
    expect(screen.queryByText(/employees|headcount|team size/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Lots of client conversations happen over email' }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Skip question' }));
  });
});

it('keeps actions disabled until progress has finished saving', async () => {
  let finish!: () => void;
  const saving = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const user = userEvent.setup();
  render(
    <WelcomeScreen
      teamName="Northwind"
      inboundEmail={null}
      initialWorkStyle={null}
      onContinue={() => saving}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Skip question' }).disabled).toBe(
    true,
  );
  await act(async () => {
    finish();
    await saving;
  });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(false);
});
