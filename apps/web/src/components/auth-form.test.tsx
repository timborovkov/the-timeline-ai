import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type * as ReactModule from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('react'),
  async (importOriginal) => {
    const actual = await importOriginal<typeof ReactModule>();
    return { ...actual, useActionState: fakes.useActionState };
  },
  () => import('react'),
);

await vi.mock(
  import.meta.resolve('@/app/actions/auth'),
  () => ({
    signInAction: vi.fn(),
    signUpAction: vi.fn(),
  }),
  () => import('@/app/actions/auth'),
);

await vi.mock(
  import.meta.resolve('@/components/turnstile-widget'),
  () => ({
    TurnstileWidget: () => <div data-testid="turnstile-widget" />,
  }),
  () => import('@/components/turnstile-widget'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { PRIVACY_VERSION, TERMS_VERSION } = await import('@/lib/legal-versions');

const { SignInForm, SignUpForm } = await import('./auth-form.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useActionState.mockReturnValue([{}, fakes.action]);
});

afterEach(cleanup);

describe('auth forms', () => {
  it('withholds account creation while legal publication is blocked', () => {
    render(<SignUpForm requiresTurnstile={false} legalPublicationReady={false} />);

    expect(screen.getByRole('status').textContent).toContain('not accepting new accounts');
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
  });

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
