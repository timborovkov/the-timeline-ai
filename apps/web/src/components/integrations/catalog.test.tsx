// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsCatalog } from '@/components/integrations/catalog';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const linearProvider = {
  id: 'linear' as const,
  label: 'Linear',
  description: 'Sync issues.',
  logo: '/integrations/linear.svg',
  available: true,
};

const githubProvider = {
  id: 'github' as const,
  label: 'GitHub',
  description: 'Sync pull requests.',
  logo: '/integrations/github.svg',
  available: true,
};

const sentryProvider = {
  id: 'sentry' as const,
  label: 'Sentry',
  description: 'Sync errors.',
  logo: '/integrations/sentry.svg',
  available: false,
};

describe('IntegrationsCatalog', () => {
  it('keeps unavailable providers inside a closed More providers disclosure', () => {
    render(<IntegrationsCatalog catalog={[linearProvider, sentryProvider]} />);

    expect(screen.getByText('Linear').closest('details')).toBeNull();
    const disclosure = screen.getByText('Sentry').closest('details');
    expect(disclosure).toBeTruthy();
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(screen.getByText(/More providers/)).toBeTruthy();
  });

  it('opens unavailable providers when none are ready to connect and explains why', () => {
    render(<IntegrationsCatalog catalog={[sentryProvider]} />);

    expect(screen.getByText(/^No providers are ready to connect\./)).toBeTruthy();
    const disclosure = screen.getByText('Sentry').closest('details');
    expect(disclosure?.open).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Connect account' }).disabled,
    ).toBe(true);
    expect(
      screen.getByText('Provider setup is required before you can connect this account.'),
    ).toBeTruthy();
  });

  it('explains an empty provider catalog instead of rendering a blank section', () => {
    render(<IntegrationsCatalog catalog={[]} />);

    expect(screen.getByText('No providers are available.')).toBeTruthy();
    expect(screen.getByText('There are no providers ready to connect right now.')).toBeTruthy();
  });

  it('announces the selected provider while opening its sign-in flow', async () => {
    const user = userEvent.setup();
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    render(<IntegrationsCatalog catalog={[linearProvider, githubProvider]} />);

    const linearCard = screen.getByText('Linear').closest('#linear');
    if (!(linearCard instanceof HTMLElement)) throw new Error('expected Linear provider card');
    const githubCard = screen.getByText('GitHub').closest('#github');
    if (!(githubCard instanceof HTMLElement)) throw new Error('expected GitHub provider card');
    await user.click(within(linearCard).getByRole('button', { name: 'Connect account' }));

    expect(screen.getByRole('status').textContent).toBe('Opening Linear sign-in');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Opening sign-in…' }).disabled,
    ).toBe(true);
    expect(
      within(githubCard).getByRole<HTMLButtonElement>('button', { name: 'Connect account' })
        .disabled,
    ).toBe(true);

    resolveFetch?.(new Response('oauth_start_failed', { status: 502 }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('keeps a provider connection failure next to the affected account', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('oauth_start_failed', { status: 502 }))),
    );

    render(<IntegrationsCatalog catalog={[linearProvider]} />);
    await user.click(screen.getByRole('button', { name: 'Connect account' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not start the connection. The provider may be temporarily unavailable — try again in a moment.',
    );
  });
});
