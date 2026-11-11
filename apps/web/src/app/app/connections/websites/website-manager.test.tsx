// Test environment: happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';

import type { ReactElement } from 'react';
const { act, cleanup, render, screen, waitFor, within } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { WebsiteManager } = await import('./website-manager');
const queryClients: QueryClient[] = [];
function renderWithQueryClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(client);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
afterEach(() => {
  for (const client of queryClients.splice(0)) client.clear();
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
  renderWithQueryClient(
    <WebsiteManager canManage={false} timezone="Europe/London" schedulesEnabled={false} />,
  );
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
  renderWithQueryClient(<WebsiteManager canManage timezone="UTC" schedulesEnabled={false} />);
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
  renderWithQueryClient(
    <WebsiteManager canManage={false} timezone="UTC" schedulesEnabled={false} />,
  );
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

it.each(['scan', 'remove'] as const)(
  'requires in-app confirmation before %s and supports cancellation',
  async (action) => {
    const user = userEvent.setup();
    const website = {
      id: 'confirmed-website',
      url: 'https://confirmation.example/',
      subject: 'own_team',
      paused: false,
      blockedReason: null,
      nextScanAt: null,
      schedule: { frequency: 'manual', time: '09:00', weekday: 1, timezone: 'UTC' },
    };
    const fetcher = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        Response.json(
          !init?.method || init.method === 'GET' ? { websites: [website] } : { ok: true },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    renderWithQueryClient(<WebsiteManager canManage timezone="UTC" schedulesEnabled={false} />);
    await screen.findByText('confirmation.example');
    if (action === 'remove') await user.click(screen.getByText('Schedule & settings'));
    const trigger = screen.getByRole('button', {
      name: action === 'scan' ? 'Scan now' : 'Remove website',
    });
    const mutations = () =>
      fetcher.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'DELETE');
    await user.click(trigger);
    let dialog = within(
      screen.getByRole('dialog', { name: action === 'scan' ? 'Scan website?' : 'Remove website?' }),
    );
    expect(mutations()).toHaveLength(0);
    expect(
      dialog.getByText(action === 'scan' ? /100 source units/ : /Captured history will remain/),
    ).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(mutations()).toHaveLength(0);
    await user.click(trigger);
    dialog = within(screen.getByRole('dialog'));
    await user.click(
      dialog.getByRole('button', { name: action === 'scan' ? 'Confirm scan' : 'Remove website' }),
    );
    await waitFor(() => {
      expect(mutations()).toHaveLength(1);
    });
    const mutation = mutations()[0];
    if (!mutation) throw new Error('Expected a confirmed request');
    const [url, init] = mutation;
    expect(url).toBe(
      action === 'scan'
        ? '/api/websites/confirmed-website/scans'
        : '/api/websites/confirmed-website',
    );
    expect(init?.method).toBe(action === 'scan' ? 'POST' : 'DELETE');
    if (action === 'scan')
      expect(JSON.parse(init?.body as string)).toEqual({ permissionConfirmed: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);

const statusWebsite = {
  id: 'status-website',
  url: 'https://status.example/',
  subject: 'own_team',
  paused: false,
  blockedReason: null,
  nextScanAt: null,
  schedule: { frequency: 'manual', time: '09:00', weekday: 1, timezone: 'UTC' },
};
const recentRun = {
  id: 'recent-run',
  status: 'completed',
  createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  finishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  changedCount: 2,
};

it.each(['queued', 'crawling', 'processing'])(
  'prevents repeat scans while a run is %s, including after reload',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            websites: [{ ...statusWebsite, latestRun: { ...recentRun, status, finishedAt: null } }],
          }),
        ),
      ),
    );
    renderWithQueryClient(
      <WebsiteManager canManage={false} timezone="UTC" schedulesEnabled={false} />,
    );
    const button = await screen.findByRole('button', {
      name: status === 'queued' ? 'Scan queued' : 'Scanning…',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('link', { name: 'View changes' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  },
);

it('shows the latest completed scan time and its timeline evidence without opening history', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(Response.json({ websites: [{ ...statusWebsite, latestRun: recentRun }] })),
    ),
  );
  renderWithQueryClient(
    <WebsiteManager canManage={false} timezone="UTC" schedulesEnabled={false} />,
  );
  await screen.findByText(/Last scanned/);
  expect(document.querySelector('time')?.getAttribute('datetime')).toBe(recentRun.finishedAt);
  expect(screen.getByRole('link', { name: 'View changes' }).getAttribute('href')).toBe(
    '/app/timeline?moment=moment%3Awebsite%3Arecent-run',
  );
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Scan now' }).disabled).toBe(false);
});

it('keeps an accepted scan disabled when refreshing the list fails', async () => {
  const user = userEvent.setup();
  let accepted = false;
  const fetcher = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      accepted = true;
      return Promise.resolve(
        Response.json({ run: { ...recentRun, status: 'queued', finishedAt: null } }),
      );
    }
    if (accepted) return Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }));
    return Promise.resolve(Response.json({ websites: [{ ...statusWebsite, latestRun: null }] }));
  });
  vi.stubGlobal('fetch', fetcher);
  renderWithQueryClient(
    <WebsiteManager canManage={false} timezone="UTC" schedulesEnabled={false} />,
  );
  await screen.findByText('Not scanned yet');
  await user.click(screen.getByRole('button', { name: 'Scan now' }));
  await user.click(screen.getByRole('button', { name: 'Confirm scan' }));
  const queued = await screen.findByRole('button', { name: 'Scan queued' });
  await user.click(queued);
  expect((queued as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
