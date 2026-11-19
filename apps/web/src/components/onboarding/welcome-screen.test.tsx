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
    expect(screen.getByDisplayValue('Northwind Studio')).toBeTruthy();
    expect(screen.getByDisplayValue('northwind-studio@inbound.test')).toBeTruthy();
    expect(screen.getByText('How does your team mostly work?')).toBeTruthy();
    expect(screen.queryByText(/employees|headcount|team size/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Lots of client conversations happen over email' }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Skip question' }));
  });

  it('shows the deferred-create copy when no inbound email exists yet', () => {
    render(
      <WelcomeScreen
        teamName="Ada's team"
        inboundEmail={null}
        initialWorkStyle={null}
        onContinue={() => Promise.resolve()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Name your team' })).toBeTruthy();
    expect(screen.getByText(/create your team email address/i)).toBeTruthy();
    expect(screen.queryByLabelText('Team email address')).toBeNull();
  });

  it('lets the user edit the prefilled team name and submits it with continue', async () => {
    const user = userEvent.setup();
    const calls: { workStyle: string | null; teamName: string }[] = [];
    render(
      <WelcomeScreen
        teamName="Ada's team"
        inboundEmail="ada-team@inbound.test"
        initialWorkStyle={null}
        onContinue={(workStyle, teamName) => {
          calls.push({ workStyle, teamName });
          return Promise.resolve();
        }}
      />,
    );

    const nameInput = screen.getByLabelText('Team name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Northstar Labs');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(calls).toEqual([{ workStyle: null, teamName: 'Northstar Labs' }]);
  });

  it('rejects an empty team name before calling onContinue', async () => {
    const user = userEvent.setup();
    let called = false;
    render(
      <WelcomeScreen
        teamName="Temp"
        inboundEmail={null}
        initialWorkStyle={null}
        onContinue={() => {
          called = true;
          return Promise.resolve();
        }}
      />,
    );

    await user.clear(screen.getByLabelText('Team name'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(called).toBe(false);
    expect(screen.getByRole('alert').textContent).toMatch(/team name/i);
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
