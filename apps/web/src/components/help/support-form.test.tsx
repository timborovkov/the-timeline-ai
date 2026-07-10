// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactModule from 'react';

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useActionState: fakes.useActionState,
  };
});

vi.mock('@/app/actions/support', () => ({
  submitSupportRequestAction: vi.fn(),
}));

vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: ({ action, siteKey }: { action: string; siteKey?: string }) => (
    <div data-testid="turnstile-widget" data-action={action} data-site-key={siteKey} />
  ),
}));

const { SupportForm } = await import('./support-form.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useActionState.mockReturnValue([{}, fakes.action, false]);
  window.history.replaceState({}, '', '/help/support?from=settings');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SupportForm', () => {
  it('renders signed-in defaults, request types, and current page context', () => {
    render(
      <SupportForm
        defaultName="Ada Lovelace"
        defaultEmail="ada@example.test"
        requiresTurnstile={false}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Ada Lovelace');
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('ada@example.test');
    expect(screen.getByLabelText<HTMLSelectElement>('Request type').value).toBe(
      'technical_support',
    );
    expect(screen.getByRole('option', { name: 'Sales' })).toBeTruthy();
    expect(screen.getByLabelText('Message').getAttribute('rows')).toBe('8');
    expect(
      screen.getByDisplayValue('http://localhost:3000/help/support?from=settings'),
    ).toHaveProperty('name', 'currentPage');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      false,
    );
  });

  it('renders Turnstile when configured and blocks submit when required protection is missing', () => {
    render(<SupportForm turnstileSiteKey="site-key" requiresTurnstile />);

    expect(screen.getByTestId('turnstile-widget').getAttribute('data-action')).toBe('support');
    expect(screen.getByTestId('turnstile-widget').getAttribute('data-site-key')).toBe('site-key');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      false,
    );

    cleanup();
    render(<SupportForm requiresTurnstile />);

    expect(screen.getByText('Support form protection is not configured.')).toBeTruthy();
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      true,
    );
  });

  it('shows success, error, and pending action states', () => {
    fakes.useActionState.mockReturnValue([{ ok: true }, fakes.action, true]);
    render(<SupportForm requiresTurnstile={false} />);

    expect(screen.getByRole('status').textContent).toBe('We received your request.');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sending…' }).disabled).toBe(true);

    cleanup();
    fakes.useActionState.mockReturnValue([{ error: 'Verification failed.' }, fakes.action, false]);
    render(<SupportForm requiresTurnstile={false} />);

    expect(screen.getByRole('alert').textContent).toBe('Verification failed.');
    expect(screen.queryByText('We received your request.')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      false,
    );
  });
});
