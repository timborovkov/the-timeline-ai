import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import { DEFAULT_TIMEZONE } from '@/lib/timezones';

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

vi.mock('next/headers', () => ({ cookies: fakes.cookies }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
    objects: {
      listNotifications: fakes.listNotifications,
      unreadNotificationCount: fakes.unreadNotificationCount,
    },
  }),
}));
vi.mock('@/components/app-shell', () => ({
  AppShell: ({
    children,
    workspaceTimezone,
  }: {
    children: ReactNode;
    workspaceTimezone: string;
  }) => <div data-workspace-timezone={workspaceTimezone}>{children}</div>,
}));
vi.mock('@/components/query-provider', () => ({
  QueryProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: { select } }));
vi.mock('@/lib/hub-status', () => ({ getNavAttentionSummary: fakes.getNavAttentionSummary }));
vi.mock('@/lib/legal', () => ({
  getUserLegalAcceptance: fakes.getUserLegalAcceptance,
  hasCurrentLegalAcceptance: fakes.hasCurrentLegalAcceptance,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

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

describe('AppLayout', () => {
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
