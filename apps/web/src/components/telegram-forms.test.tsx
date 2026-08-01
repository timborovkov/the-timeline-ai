// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactModule from 'react';
import type * as ReactDomModule from 'react-dom';

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
  useFormStatus: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useActionState: fakes.useActionState,
  };
});

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDomModule>();
  return {
    ...actual,
    useFormStatus: fakes.useFormStatus,
  };
});

vi.mock('@/app/actions/telegram', () => ({
  generateGroupLinkTokenAction: vi.fn(),
  generatePersonalLinkTokenAction: vi.fn(),
}));

const { GenerateGroupTokenForm, GeneratePersonalTokenForm } = await import('./telegram-forms.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useFormStatus.mockReturnValue({ pending: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function mockTokenState(state: {
  error?: string;
  fieldError?: string;
  scope?: 'personal' | 'group';
  token?: string;
}) {
  fakes.useActionState.mockReturnValue([state, fakes.action]);
}

describe('Telegram link token forms', () => {
  it('renders personal link tokens with a bot deep link', () => {
    mockTokenState({ scope: 'personal', token: 'personal-token' });

    render(<GeneratePersonalTokenForm botUsername="timeline_bot" />);

    expect(screen.getByLabelText('Your Telegram @username').getAttribute('name')).toBe(
      'tgUsername',
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Generate personal link' }).disabled,
    ).toBe(false);
    expect(screen.getByText(/Single-use token/)).toBeTruthy();
    expect(screen.getByText('/link personal-token')).toBeTruthy();
    expect(screen.getAllByRole('status')[0]?.textContent).toContain(
      'Link token created. It expires in 15 minutes.',
    );
    expect(screen.getByRole('button', { name: 'Copy link command' })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open Telegram link' });
    expect(link.getAttribute('href')).toBe('https://t.me/timeline_bot?start=personal-token');
  });

  it('renders group token deep links with startgroup and pending submit state', () => {
    mockTokenState({ scope: 'group', token: 'group-token' });
    fakes.useFormStatus.mockReturnValue({ pending: true });

    render(<GenerateGroupTokenForm botUsername="timeline_bot" />);

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Working…' }).disabled).toBe(true);
    const link = screen.getByRole('link', { name: 'Open Telegram link' });
    expect(link.getAttribute('href')).toBe('https://t.me/timeline_bot?startgroup=group-token');
  });

  it('connects username validation errors to the field without exposing stale tokens', () => {
    mockTokenState({ fieldError: 'Username is already linked.' });

    render(<GeneratePersonalTokenForm botUsername={null} />);

    const username = screen.getByLabelText('Your Telegram @username');
    expect(username.getAttribute('aria-invalid')).toBe('true');
    expect(username.getAttribute('aria-describedby')).toBe(
      'personal-tg-username-help personal-tg-username-error',
    );
    expect(screen.getByRole('alert').textContent).toContain('Username is already linked.');
    expect(screen.queryByText(/Single-use token/)).toBeNull();

    cleanup();
    mockTokenState({ scope: 'personal', token: 'fresh-token' });
    render(<GeneratePersonalTokenForm botUsername={null} />);

    expect(screen.getByText('TELEGRAM_BOT_USERNAME')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /t\.me/ })).toBeNull();
  });

  it('keeps a stable token status region and leaves form-level errors off the username field', () => {
    mockTokenState({});
    const { rerender } = render(<GeneratePersonalTokenForm botUsername="timeline_bot" />);
    const status = screen.getAllByRole('status')[0];
    expect(status?.textContent).toBe('');

    mockTokenState({ scope: 'personal', token: 'fresh-token' });
    rerender(<GeneratePersonalTokenForm botUsername="timeline_bot" />);
    expect(screen.getAllByRole('status')[0]).toBe(status);
    expect(status?.textContent).toContain('Link token created. It expires in 15 minutes.');

    cleanup();
    mockTokenState({ error: 'Not signed in' });
    render(<GeneratePersonalTokenForm botUsername="timeline_bot" />);
    expect(screen.getByRole('alert').textContent).toContain('Not signed in');
    expect(
      screen.getByLabelText('Your Telegram @username').getAttribute('aria-invalid'),
    ).toBeNull();
  });
});
