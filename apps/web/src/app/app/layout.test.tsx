import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { ReactNode } from 'react';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  cookies: vi.fn(),
  getCalendarSettings: vi.fn(),
  getNavAttentionSummary: vi.fn(),
  getUserLegalAcceptance: vi.fn(),
  hasCurrentLegalAcceptance: vi.fn(),
  listNotifications: vi.fn(),
  reportCaughtError: vi.fn(),
  resolveActiveTeam: vi.fn(),
  unreadNotificationCount: vi.fn(),
}));

function queryResult<T>(value: T) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    limit: () => chain,
    then: <TResult1 = T, TResult2 = never>(
      onfulfilled?: ((result: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(value).then(onfulfilled, onrejected),
    where: () => chain,
  };
  return chain;
}

const selectResults = [
  [{ email: 'tim@example.com', emailVerified: new Date('2026-01-01T00:00:00.000Z') }],
  [],
];
const select = vi.fn(() => queryResult(selectResults.shift() ?? []));

await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({ cookies: fakes.cookies }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: (path: string) => {
      throw new Error(`redirect:${path}`);
    },
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      calendar: { getCalendarSettings: fakes.getCalendarSettings },
      objects: {
        listNotifications: fakes.listNotifications,
        unreadNotificationCount: fakes.unreadNotificationCount,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/components/app-shell'),
  () => ({
    AppShell: ({
      children,
      workspaceTimezone,
    }: {
      children: ReactNode;
      workspaceTimezone: string;
    }) => <div data-workspace-timezone={workspaceTimezone}>{children}</div>,
  }),
  () => import('@/components/app-shell'),
);
await vi.mock(
  import.meta.resolve('@/components/query-provider'),
  () => ({
    QueryProvider: ({ children }: { children: ReactNode }) => children,
  }),
  () => import('@/components/query-provider'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: { select } }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/hub-status'),
  () => ({ getNavAttentionSummary: fakes.getNavAttentionSummary }),
  () => import('@/lib/hub-status'),
);
await vi.mock(
  import.meta.resolve('@/lib/legal'),
  () => ({
    getUserLegalAcceptance: fakes.getUserLegalAcceptance,
    hasCurrentLegalAcceptance: fakes.hasCurrentLegalAcceptance,
  }),
  () => import('@/lib/legal'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);

const { renderToStaticMarkup } = await import('react-dom/server');
const { DEFAULT_TIMEZONE } = await import('@/lib/timezones');

const { default: AppLayout } = await import('./layout.js');

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.splice(
    0,
    selectResults.length,
    [{ email: 'tim@example.com', emailVerified: new Date('2026-01-01T00:00:00.000Z') }],
    [],
  );
  fakes.auth.mockResolvedValue({ user: { id: 'user-1', name: 'Tim', email: 'tim@example.com' } });
  fakes.cookies.mockResolvedValue({ get: () => undefined });
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: DEFAULT_TIMEZONE });
  fakes.getNavAttentionSummary.mockResolvedValue({});
  fakes.getUserLegalAcceptance.mockResolvedValue({});
  fakes.hasCurrentLegalAcceptance.mockReturnValue(true);
  fakes.listNotifications.mockResolvedValue([]);
  fakes.resolveActiveTeam.mockResolvedValue({
    active: {
      teamId: 'team-1',
      teamName: 'AuditAI',
      teamSlug: 'audit-ai',
      role: 'owner',
    },
    memberships: [],
  });
  fakes.unreadNotificationCount.mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AppLayout', () => {
  it.each([undefined, 'false'])(
    'allows existing users with stale acceptance when production publication readiness is %s',
    async (readiness) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('LEGAL_PUBLICATION_READY', readiness);
      fakes.hasCurrentLegalAcceptance.mockReturnValue(false);

      const html = renderToStaticMarkup(await AppLayout({ children: <p>Home</p>, modal: null }));

      expect(html).toContain('Home');
    },
  );

  it('allows existing users without an acceptance snapshot while publication is withheld', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEGAL_PUBLICATION_READY', 'false');
    fakes.getUserLegalAcceptance.mockResolvedValue(null);

    const html = renderToStaticMarkup(await AppLayout({ children: <p>Home</p>, modal: null }));

    expect(html).toContain('Home');
  });

  it.each(['stale', 'missing'])(
    'requires %s acceptance once legal publication is ready',
    async (acceptance) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('LEGAL_PUBLICATION_READY', 'true');
      fakes.getUserLegalAcceptance.mockResolvedValue(acceptance === 'missing' ? null : {});
      fakes.hasCurrentLegalAcceptance.mockReturnValue(false);

      await expect(AppLayout({ children: <p>Home</p>, modal: null })).rejects.toThrow(
        'redirect:/legal/accept',
      );
    },
  );

  it('requires sign-in while legal publication is withheld', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEGAL_PUBLICATION_READY', 'false');
    fakes.auth.mockResolvedValue(null);

    await expect(AppLayout({ children: <p>Home</p>, modal: null })).rejects.toThrow(
      'redirect:/sign-in',
    );
  });

  it('renders with the default timezone when calendar settings fail', async () => {
    const error = new Error('calendar settings unavailable');
    fakes.getCalendarSettings.mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const html = renderToStaticMarkup(await AppLayout({ children: <p>Home</p>, modal: null }));

    expect(html).toContain(`data-workspace-timezone="${DEFAULT_TIMEZONE}"`);
    expect(html).toContain('Home');
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(error, {
      operation: 'calendar_settings',
      surface: 'layout',
    });
    consoleError.mockRestore();
  });
});
