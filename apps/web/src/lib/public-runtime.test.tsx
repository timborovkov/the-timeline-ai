import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { DEFAULT_SUPPORT_EMAIL } from '@/lib/support-links';

// Test environment: happy-dom

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { resetPublicRuntimeCache, usePublicRuntime } = await import('@/lib/public-runtime');

afterEach(() => {
  cleanup();
  resetPublicRuntimeCache();
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
    >
      {runtime.supportEmail}
    </div>
  );
}

describe('usePublicRuntime', () => {
  it('loads request-time public config and updates the task-category dataset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          supportEmail: 'help@example.test',
          turnstileSiteKey: 'site-key',
          requiresTurnstile: false,
          taskCategoriesEnabled: false,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    document.body.dataset.taskCategoriesEnabled = 'true';

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByText('help@example.test')).toBeTruthy();
    });
    expect(screen.getByText('help@example.test').getAttribute('data-turnstile')).toBe('false');
    expect(screen.getByText('help@example.test').getAttribute('data-categories')).toBe('false');
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

  it('skips the fetch when the caller already supplied runtime values', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<Probe enabled={false} />);

    expect(screen.getByText(DEFAULT_SUPPORT_EMAIL)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
