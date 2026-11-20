import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Test environment: happy-dom

const route = vi.hoisted(() => ({ pathname: '/help' }));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => route.pathname,
  }),
  () => import('next/navigation'),
);

const { PublicHeader } = await import('@/components/public-header');
const { PublicSessionBranch } = await import('@/components/public-session-branch');
const { refreshPublicSession, resetPublicSessionCache, setPublicSessionCache, usePublicSession } =
  await import('@/lib/public-session');
const { act, cleanup, render, screen, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  resetPublicSessionCache();
  route.pathname = '/help';
  vi.unstubAllGlobals();
});

function SessionStatus() {
  const session = usePublicSession();
  return <span>{session.status}</span>;
}

function SessionLinks() {
  return (
    <PublicSessionBranch
      signedOut={<a href="/sign-in">Sign in</a>}
      signedIn={<a href="/app">Dashboard</a>}
    />
  );
}

describe('public session island', () => {
  it('server-renders usable guest account links before the session resolves', () => {
    const html = renderToStaticMarkup(<PublicHeader currentSection="product" />);

    expect(html).toContain('data-public-session="unknown"');
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain('>Start free</a>');
    expect(html).toContain('>Sign in</a>');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('>Dashboard</a>');
    expect(html).toMatch(
      /<span[^>]*data-active="false"[^>]*aria-hidden="true"[^>]*inert[^>]*>[\s\S]*?>Dashboard<\/a>/,
    );
  });

  it('keeps guest CTAs usable while the session request is in flight, then swaps to Dashboard', async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(held);
    vi.stubGlobal('fetch', fetchMock);

    render(<PublicHeader currentSection="help" />);

    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    for (const link of screen.getAllByRole('link', { name: 'Sign in' })) {
      expect(link.getAttribute('href')).toBe('/sign-in');
    }
    expect(screen.getByRole('link', { name: 'Start free' }).getAttribute('href')).toBe('/sign-up');

    release(Response.json({ user: { name: 'Ada', email: 'ada@example.test' } }));

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

  it('refetches after an explicit auth-change refresh', async () => {
    setPublicSessionCache({ status: 'signed-out' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { name: 'Ada', email: 'ada@example.test' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SessionStatus />);
    expect(screen.getByText('signed-out')).toBeTruthy();

    await act(async () => {
      await refreshPublicSession();
    });

    expect(screen.getByText('signed-in')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('refreshes the cached session on window focus after sign-in', async () => {
    setPublicSessionCache({ status: 'signed-out' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { name: 'Ada', email: 'ada@example.test' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SessionLinks />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/app');
    });
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('refreshes the cached session when the public path changes', async () => {
    setPublicSessionCache({ status: 'signed-out' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { name: 'Ada', email: 'ada@example.test' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<SessionLinks />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    route.pathname = '/trust';
    rerender(<SessionLinks />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/app');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });
});

describe('public session request generations', () => {
  it('does not let an old response release a newer in-flight request after reset', async () => {
    let finishOld!: (response: Response) => void;
    let finishNew!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishNew = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const oldRequest = refreshPublicSession();
    resetPublicSessionCache();
    const newRequest = refreshPublicSession();
    finishOld(Response.json({ user: { name: 'Old' } }));
    await oldRequest;
    expect(refreshPublicSession()).toBe(newRequest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finishNew(Response.json({ user: { name: 'Current' } }));
    await expect(newRequest).resolves.toMatchObject({ status: 'signed-in', name: 'Current' });
  });

  it('does not replace explicitly installed auth state with an older response', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const request = refreshPublicSession();
    setPublicSessionCache({ status: 'signed-out' });
    finish(Response.json({ user: { name: 'Old' } }));
    await expect(request).resolves.toEqual({ status: 'signed-out' });
  });
});
