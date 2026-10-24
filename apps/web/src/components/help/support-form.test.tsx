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
vi.mock('@/components/form-action-toast', () => ({
  FormActionToast: () => null,
}));

const { SupportForm } = await import('./support-form.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useActionState.mockReturnValue([{}, fakes.action, false]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SupportForm', () => {
  it('renders signed-in defaults, request types, and minimized diagnostic context', () => {
    render(
      <SupportForm
        defaultName="Ada Lovelace"
        defaultEmail="ada@example.test"
        defaultSurface="team_integrations"
        defaultErrorReference="sentry-reference"
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
    expect(screen.getByDisplayValue('team_integrations')).toHaveProperty('name', 'surface');
    expect(screen.getByDisplayValue('sentry-reference')).toHaveProperty('name', 'errorReference');
    expect(document.querySelector('[name="currentPage"]')).toBeNull();
    expect(
      screen.getByText(/Workspace content is never attached automatically/).textContent,
    ).toContain('Your IP address may be used briefly');
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

    const protectionError = document.querySelector<HTMLElement>('#support-form-protection-error');
    if (!protectionError) throw new Error('expected support form protection message');
    expect(protectionError.textContent).toBe(
      'Support form protection is unavailable. Email contact@thetimeline.cc instead.',
    );
    expect(protectionError.id).toBe('support-form-protection-error');
    expect(protectionError.getAttribute('role')).toBeNull();
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(screen.getByRole('link', { name: 'contact@thetimeline.cc' }).getAttribute('href')).toBe(
      'mailto:contact@thetimeline.cc',
    );
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' });
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('aria-describedby')).toBe(protectionError.id);
  });

  it('keeps pending submit state on the button without inline banners', () => {
    fakes.useActionState.mockReturnValue([{ ok: true }, fakes.action, true]);
    render(<SupportForm requiresTurnstile={false} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('We received your request.')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sending…' }).disabled).toBe(true);

    cleanup();
    fakes.useActionState.mockReturnValue([{ error: 'Verification failed.' }, fakes.action, false]);
    render(<SupportForm requiresTurnstile={false} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Verification failed.')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      false,
    );
  });

  it('shows the durable request reference and delivery fallback after saving', () => {
    fakes.useActionState.mockReturnValue([
      {
        ok: true,
        requestReference: 'request-reference',
        warning: 'Your request was saved, but email delivery is currently unavailable.',
      },
      fakes.action,
      false,
    ]);

    render(<SupportForm requiresTurnstile={false} />);

    expect(screen.getByRole('status').textContent).toContain('request-reference');
    expect(screen.getByRole('status').textContent).toContain(
      'email delivery is currently unavailable',
    );
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });
});
