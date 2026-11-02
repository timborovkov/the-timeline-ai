import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PublicHeader } from '@/components/public-header';
import { PublicSessionBranch } from '@/components/public-session-branch';
import {
  resetPublicSessionCache,
  setPublicSessionCache,
  usePublicSession,
} from '@/lib/public-session';

// Test environment: happy-dom

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  resetPublicSessionCache();
  vi.unstubAllGlobals();
});

function SessionStatus() {
  const session = usePublicSession();
  return <span>{session.status}</span>;
}

describe('public session island', () => {
  it('server-renders account actions as a pending signed-out placeholder', () => {
    const html = renderToStaticMarkup(<PublicHeader currentSection="product" />);

    expect(html).toContain('data-public-session="unknown"');
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('>Start free</a>');
    expect(html).toContain('invisible');
    expect(html).toContain('inert');
    expect(html).not.toContain('>Dashboard</a>');
  });

  it('resolves Sign in versus Dashboard from the session endpoint without flashing the wrong CTA', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { name: 'Ada', email: 'ada@example.test' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicHeader currentSection="help" />);

    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start free' })).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/app');
    });
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start free' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('reuses the cached session across islands', () => {
    setPublicSessionCache({ status: 'signed-out' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <>
        <SessionStatus />
        <PublicSessionBranch
          signedOut={<a href="/sign-in">Sign in</a>}
          signedIn={<a href="/app">Dashboard</a>}
        />
      </>,
    );

    expect(screen.getByText('signed-out')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
