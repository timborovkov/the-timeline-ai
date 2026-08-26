// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactModule from 'react';

import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, useActionState: fakes.useActionState };
});

vi.mock('@/app/actions/auth', () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
}));

vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget" />,
}));

const { SignInForm, SignUpForm } = await import('./auth-form.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useActionState.mockReturnValue([{}, fakes.action]);
});

afterEach(cleanup);

describe('auth forms', () => {
  it('keeps labels and submit controls available for sign-in', () => {
    render(<SignInForm />);

    expect(screen.getByLabelText('Email')).toHaveProperty('name', 'email');
    expect(screen.getByLabelText('Password')).toHaveProperty('name', 'password');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sign in' }).disabled).toBe(false);
  });

  it('announces sign-in and sign-up failures', () => {
    fakes.useActionState.mockReturnValue([
      { error: 'Unable to sign in. Try again.' },
      fakes.action,
    ]);
    render(<SignInForm />);
    expect(screen.getByRole('alert').textContent).toBe('Unable to sign in. Try again.');

    cleanup();
    fakes.useActionState.mockReturnValue([
      { error: 'Choose a password with at least 8 characters.' },
      fakes.action,
    ]);
    render(<SignUpForm requiresTurnstile={false} />);
    expect(screen.getByRole('alert').textContent).toBe(
      'Choose a password with at least 8 characters.',
    );
  });

  it('binds credential acceptance to the legal versions rendered in the form', () => {
    render(<SignUpForm requiresTurnstile={false} />);

    expect(document.querySelector<HTMLInputElement>('input[name="termsVersion"]')?.value).toBe(
      TERMS_VERSION,
    );
    expect(document.querySelector<HTMLInputElement>('input[name="privacyVersion"]')?.value).toBe(
      PRIVACY_VERSION,
    );
  });
});
