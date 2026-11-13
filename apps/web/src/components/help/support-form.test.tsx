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
    return {
      ...actual,
      useActionState: fakes.useActionState,
    };
  },
  () => import('react'),
);

await vi.mock(
  import.meta.resolve('@/app/actions/support'),
  () => ({
    submitSupportRequestAction: vi.fn(),
  }),
  () => import('@/app/actions/support'),
);

await vi.mock(
  import.meta.resolve('@/components/turnstile-widget'),
  () => ({
    TurnstileWidget: ({ action, siteKey }: { action: string; siteKey?: string }) => (
      <div data-testid="turnstile-widget" data-action={action} data-site-key={siteKey} />
    ),
  }),
  () => import('@/components/turnstile-widget'),
);
await vi.mock(
  import.meta.resolve('@/components/form-action-toast'),
  () => ({
    FormActionToast: () => null,
  }),
  () => import('@/components/form-action-toast'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => '/help/support',
  }),
  () => import('next/navigation'),
);

const { act, cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

const { SupportForm } = await import('./support-form.js');
const { SupportEmailProvider } = await import('@/components/support-email-provider');
const { resetPublicRuntimeCache } = await import('@/lib/public-runtime');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useActionState.mockReturnValue([{}, fakes.action, false]);
});

afterEach(() => {
  cleanup();
  resetPublicRuntimeCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it('renders Turnstile when configured and blocks submit when required protection is missing', async () => {
    render(<SupportForm turnstileSiteKey="site-key" requiresTurnstile />);

    expect(screen.getByTestId('turnstile-widget').getAttribute('data-action')).toBe('support');
    expect(screen.getByTestId('turnstile-widget').getAttribute('data-site-key')).toBe('site-key');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      false,
    );

    cleanup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          supportEmail: 'contact@thetimeline.cc',
          turnstileSiteKey: null,
          requiresTurnstile: true,
          taskCategoriesEnabled: true,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportForm requiresTurnstile />);

    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(document.querySelector('#support-form-protection-error')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      true,
    );

    await waitFor(() => {
      expect(document.querySelector('#support-form-protection-error')).toBeTruthy();
    });
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
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public/runtime',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('uses the request-time support address from the public runtime endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          supportEmail: 'help@example.test',
          turnstileSiteKey: null,
          requiresTurnstile: true,
          taskCategoriesEnabled: true,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SupportEmailProvider>
        <SupportForm />
      </SupportEmailProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'help@example.test' }).getAttribute('href')).toBe(
        'mailto:help@example.test',
      );
    });
  });

  it('loads the Turnstile site key from the runtime endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          supportEmail: 'contact@thetimeline.cc',
          turnstileSiteKey: 'runtime-site-key',
          requiresTurnstile: true,
          taskCategoriesEnabled: true,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SupportForm requiresTurnstile />);

    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('turnstile-widget').getAttribute('data-site-key')).toBe(
        'runtime-site-key',
      );
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      false,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public/runtime',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('recovers the Turnstile site key after a failed runtime load on window focus', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            supportEmail: 'help@example.test',
            turnstileSiteKey: 'runtime-site-key',
            requiresTurnstile: true,
            taskCategoriesEnabled: true,
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<SupportForm requiresTurnstile />);

    await waitFor(() => {
      expect(document.querySelector('#support-form-protection-error')).toBeTruthy();
    });
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('turnstile-widget').getAttribute('data-site-key')).toBe(
        'runtime-site-key',
      );
    });
    expect(document.querySelector('#support-form-protection-error')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send request' }).disabled).toBe(
      false,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fills signed-in defaults only when the visitor has not typed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SupportForm requiresTurnstile={false} />);
    const name = screen.getByLabelText<HTMLInputElement>('Name');
    const email = screen.getByLabelText<HTMLInputElement>('Email');

    await user.type(name, 'Visitor');
    rerender(
      <SupportForm
        defaultName="Ada Lovelace"
        defaultEmail="ada@example.test"
        requiresTurnstile={false}
      />,
    );

    expect(name.value).toBe('Visitor');
    expect(email.value).toBe('ada@example.test');
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
    expect(document.activeElement).toBe(screen.getByRole('status'));
    expect(screen.getByRole('status').textContent).toContain(
      'email delivery is currently unavailable',
    );
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });
  it('keeps keyboard and reduced-motion confirmations instant while fading pointer feedback', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    try {
      for (const [pointer, reduced] of [
        [true, false],
        [false, false],
        [true, true],
      ]) {
        vi.spyOn(window, 'matchMedia').mockReturnValue({
          matches: reduced,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaQueryList);
        animate.mockClear();
        fakes.useActionState.mockReturnValue([{}, fakes.action, false]);
        const { rerender } = render(<SupportForm requiresTurnstile={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }), {
          detail: pointer ? 1 : 0,
        });
        fakes.useActionState.mockReturnValue([
          { ok: true, requestReference: 'synthetic-reference' },
          fakes.action,
          false,
        ]);
        rerender(<SupportForm requiresTurnstile={false} />);
        expect(document.activeElement).toBe(screen.getByRole('status'));
        expect(screen.getByText('synthetic-reference')).toBeTruthy();
        expect(animate).toHaveBeenCalledTimes(pointer && !reduced ? 1 : 0);
        cleanup();
      }
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });
});
