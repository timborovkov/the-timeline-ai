import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, it } from 'bun:test';

import type * as ReactModule from 'react';
const state = vi.fn();
await vi.mock(
  import.meta.resolve('react'),
  async (original) => ({ ...(await original<typeof ReactModule>()), useActionState: state }),
  () => import('react'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/password-recovery'),
  () => ({ requestPasswordResetAction: vi.fn(), resetPasswordAction: vi.fn() }),
  () => import('@/app/actions/password-recovery'),
);
const { cleanup, render, screen } = await import('@testing-library/react');
const { ForgotPasswordForm, ResetPasswordForm } =
  await import('@/components/password-recovery-form');
beforeEach(() => {
  state.mockReturnValue([{}, vi.fn(), false]);
});
afterEach(cleanup);
it('labels inputs and disables repeat requests while pending', () => {
  state.mockReturnValue([{}, vi.fn(), true]);
  render(<ForgotPasswordForm />);
  expect(screen.getByLabelText('Email')).toHaveProperty('type', 'email');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sending…' }).disabled).toBe(true);
});
it('announces generic confirmation and permits requesting another email', () => {
  state.mockReturnValue([{ ok: true }, vi.fn(), false]);
  render(<ForgotPasswordForm />);
  expect(screen.getByRole('status').textContent).toContain('If an account');
  expect(screen.getByRole('button', { name: 'Send reset link' })).toBeDefined();
});
it('offers password-manager compatible new password fields', () => {
  render(<ResetPasswordForm token="secret" />);
  expect(screen.getByLabelText('New password')).toHaveProperty('autocomplete', 'new-password');
  expect(screen.getByLabelText('Confirm new password')).toHaveProperty(
    'autocomplete',
    'new-password',
  );
});
it('replaces an unusable link with an accessible recovery link', () => {
  state.mockReturnValue([
    { invalidToken: true, error: 'This reset link has expired.' },
    vi.fn(),
    false,
  ]);
  render(<ResetPasswordForm token="secret" />);
  expect(screen.getByRole('alert').textContent).toContain('expired');
  expect(screen.getByRole('link', { name: 'Request a new reset link' }).getAttribute('href')).toBe(
    '/forgot-password',
  );
});
it('announces successful reset and removes the password form', () => {
  state.mockReturnValue([{ ok: true }, vi.fn(), false]);
  render(<ResetPasswordForm token="secret" />);
  expect(screen.getByRole('status').textContent).toContain('all previous sessions');
  expect(screen.queryByLabelText('New password')).toBeNull();
});
