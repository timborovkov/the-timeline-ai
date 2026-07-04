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

function mockTokenState(state: { error?: string; scope?: 'personal' | 'group'; token?: string }) {
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
    const link = screen.getByRole('link', {
      name: 'https://t.me/timeline_bot?start=personal-token',
    });
    expect(link.getAttribute('href')).toBe('https://t.me/timeline_bot?start=personal-token');
  });

  it('renders group token deep links with startgroup and pending submit state', () => {
    mockTokenState({ scope: 'group', token: 'group-token' });
    fakes.useFormStatus.mockReturnValue({ pending: true });

    render(<GenerateGroupTokenForm botUsername="timeline_bot" />);

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Working…' }).disabled).toBe(true);
    const link = screen.getByRole('link', {
      name: 'https://t.me/timeline_bot?startgroup=group-token',
    });
    expect(link.getAttribute('href')).toBe('https://t.me/timeline_bot?startgroup=group-token');
  });

  it('shows action errors and missing-bot guidance without exposing stale tokens', () => {
    mockTokenState({ error: 'Username is already linked.' });

    render(<GeneratePersonalTokenForm botUsername={null} />);

    expect(screen.getByText('Username is already linked.')).toBeTruthy();
    expect(screen.queryByText(/Single-use token/)).toBeNull();

    cleanup();
    mockTokenState({ scope: 'personal', token: 'fresh-token' });
    render(<GeneratePersonalTokenForm botUsername={null} />);

    expect(screen.getByText('TELEGRAM_BOT_USERNAME')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /t\.me/ })).toBeNull();
  });
});
