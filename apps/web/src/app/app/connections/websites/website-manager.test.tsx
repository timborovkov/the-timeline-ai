// Test environment: happy-dom
import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';
const { act, cleanup, render, screen, waitFor, within } = await import('@testing-library/react');
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
  await screen.findByText('example.com');
  expect(screen.queryByRole('button', { name: 'Remove website' })).toBeNull();
  expect(screen.queryByText('Schedule & settings')).toBeNull();
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
  await user.click(screen.getByRole('button', { name: 'Add website' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByRole('textbox', { name: 'Website URL' }), 'https://example.com');
  await user.click(screen.getByRole('checkbox', { name: /permission/ }));
  await user.click(dialog.getByRole('button', { name: 'Add website' }));
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

it('ignores an older history response after selecting another website', async () => {
  const user = userEvent.setup();
  let resolveOlder!: (response: Response) => void;
  const older = new Promise<Response>((resolve) => {
    resolveOlder = resolve;
  });
  const websites = ['first', 'second'].map((id) => ({
    id,
    url: `https://${id}.example`,
    subject: 'own_team',
    paused: false,
    blockedReason: null,
    nextScanAt: null,
    schedule: { frequency: 'manual', time: '09:00', weekday: 1, timezone: 'UTC' },
  }));
  const run = (id: string, changedCount: number) => ({
    id,
    status: 'completed',
    pageCount: 5,
    changedCount,
    sourceUnits: 100,
    createdAt: '2026-11-10T09:00:00Z',
    failureReason: null,
  });
  const fetcher = vi.fn((url: string) => {
    if (url.endsWith('/first')) return older;
    if (url.endsWith('/second'))
      return Promise.resolve(Response.json({ runs: [run('second-run', 2)] }));
    return Promise.resolve(Response.json({ websites }));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<WebsiteManager canManage={false} timezone="UTC" schedulesEnabled={false} />);
  await screen.findByText('first.example');
  const [firstHistory, secondHistory] = screen.getAllByRole('button', { name: 'History' });
  if (!firstHistory || !secondHistory) throw new Error('Expected both website history controls');
  await user.click(firstHistory);
  await waitFor(() => {
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/first'))).toBe(true);
  });
  await user.click(secondHistory);
  await screen.findByText('5 pages · 2 changed');
  await act(async () => {
    resolveOlder(Response.json({ runs: [run('first-run', 4)] }));
    await older;
  });
  expect(screen.getByText('5 pages · 2 changed')).toBeTruthy();
  expect(screen.queryByText('5 pages · 4 changed')).toBeNull();
  expect(screen.getByRole('link', { name: 'View changes' }).getAttribute('href')).toContain(
    'second-run',
  );
});
