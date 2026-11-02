import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { DEFAULT_SUPPORT_EMAIL } from '@/lib/support-links';

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

const { act, cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { refreshPublicRuntime, resetPublicRuntimeCache, usePublicRuntime } =
  await import('@/lib/public-runtime');

afterEach(() => {
  cleanup();
  resetPublicRuntimeCache();
  route.pathname = '/help';
  vi.unstubAllGlobals();
  delete document.body.dataset.taskCategoriesEnabled;
});

function Probe({ enabled = true }: { enabled?: boolean }) {
  const runtime = usePublicRuntime(enabled);
  if (runtime.status !== 'ready') return <div>unknown</div>;
  return (
    <div
      data-status={runtime.status}
      data-turnstile={String(runtime.requiresTurnstile)}
      data-categories={String(runtime.taskCategoriesEnabled)}
      data-site-key={runtime.turnstileSiteKey ?? ''}
    >
      {runtime.supportEmail}
    </div>
  );
}

function runtimePayload(overrides?: Record<string, unknown>) {
  return {
    supportEmail: 'help@example.test',
    turnstileSiteKey: 'site-key',
    requiresTurnstile: false,
    taskCategoriesEnabled: false,
    ...overrides,
  };
}

function okResponse(payload: Record<string, unknown> = runtimePayload()) {
  return {
    ok: true,
    json: () => Promise.resolve(payload),
  };
}

describe('usePublicRuntime', () => {
  it('loads request-time public config and updates the task-category dataset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    document.body.dataset.taskCategoriesEnabled = 'true';

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByText('help@example.test')).toBeTruthy();
    });
    expect(screen.getByText('help@example.test').getAttribute('data-turnstile')).toBe('false');
    expect(screen.getByText('help@example.test').getAttribute('data-categories')).toBe('false');
    expect(screen.getByText('help@example.test').getAttribute('data-site-key')).toBe('site-key');
    expect(document.body.dataset.taskCategoriesEnabled).toBe('false');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public/runtime',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('falls back to the canonical support address when the endpoint fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByText(DEFAULT_SUPPORT_EMAIL)).toBeTruthy();
    });
  });

  it('does not refetch a failed load until focus or navigation', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<Probe />);
    await waitFor(() => {
      expect(screen.getByText(DEFAULT_SUPPORT_EMAIL)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<Probe />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches a failed load on window focus and recovers the Turnstile key', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByText(DEFAULT_SUPPORT_EMAIL)).toBeTruthy();
    });
    expect(screen.getByText(DEFAULT_SUPPORT_EMAIL).getAttribute('data-site-key')).toBe('');

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByText('help@example.test').getAttribute('data-site-key')).toBe('site-key');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches a non-2xx load when the public path changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<Probe />);
    await waitFor(() => {
      expect(screen.getByText(DEFAULT_SUPPORT_EMAIL)).toBeTruthy();
    });

    route.pathname = '/help/support';
    rerender(<Probe />);

    await waitFor(() => {
      expect(screen.getByText('help@example.test').getAttribute('data-site-key')).toBe('site-key');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a successful Turnstile key when a later refresh fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse())
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByText('help@example.test').getAttribute('data-site-key')).toBe('site-key');
    });

    await act(async () => {
      await refreshPublicRuntime();
    });

    expect(screen.getByText('help@example.test').getAttribute('data-site-key')).toBe('site-key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips the fetch when the caller already supplied runtime values', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<Probe enabled={false} />);

    expect(screen.getByText(DEFAULT_SUPPORT_EMAIL)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
