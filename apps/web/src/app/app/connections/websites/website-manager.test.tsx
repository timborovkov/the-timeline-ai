// Test environment: happy-dom
import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';
const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { WebsiteManager } = await import('./website-manager');
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('shows weighted usage and keeps schedule/removal controls admin-only', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          websites: [
            {
              id: 'website',
              url: 'https://example.com/',
              subject: 'own_team',
              paused: false,
              blockedReason: null,
              nextScanAt: null,
              schedule: {
                frequency: 'manual',
                time: '09:00',
                weekday: 1,
                timezone: 'Europe/London',
              },
            },
          ],
        }),
      ),
    ),
  );
  render(<WebsiteManager canManage={false} timezone="Europe/London" schedulesEnabled={false} />);
  await screen.findByText('https://example.com/');
  expect(screen.queryByRole('button', { name: 'Remove source' })).toBeNull();
  expect(screen.queryByText('Frequency')).toBeNull();
  expect(screen.getByText(/20 source/)).toBeTruthy();
});
it('creates a website with explicit permission without automatically starting a scan', async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      Response.json(init?.method === 'POST' ? { website: { id: 'new' } } : { websites: [] }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<WebsiteManager canManage timezone="UTC" schedulesEnabled={false} />);
  await user.type(
    screen.getByRole('textbox', { name: 'Public website URL' }),
    'https://example.com',
  );
  await user.click(screen.getByRole('checkbox', { name: /permission/ }));
  await user.click(screen.getByRole('button', { name: 'Add website' }));
  await waitFor(() => {
    expect(
      fetcher.mock.calls.some(
        ([url, init]) =>
          url === '/api/websites' &&
          init?.method === 'POST' &&
          (
            JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
              permissionConfirmed?: boolean;
            }
          ).permissionConfirmed === true,
      ),
    ).toBe(true);
  });
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/scans'))).toBe(false);
});
