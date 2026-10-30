import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type { NextFetchEvent } from 'next/server';
const mocks = vi.hoisted(() => ({
  migrateActiveTeamCookie: vi.fn().mockResolvedValue(undefined),
  scheduleSurfaceRequest: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/active-team-cookie-migration'),
  () => ({
    migrateLegacyActiveTeamCookie: mocks.migrateActiveTeamCookie,
  }),
  () => import('@/lib/active-team-cookie-migration'),
);
await vi.mock(
  import.meta.resolve('@/lib/surface-request-analytics'),
  () => ({
    schedulePersonlessSurfaceRequest: mocks.scheduleSurfaceRequest,
  }),
  () => import('@/lib/surface-request-analytics'),
);

const { NextRequest } = await import('next/server');
const { proxy } = await import('@/proxy');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';

function context(): NextFetchEvent {
  return {
    passThroughOnException: vi.fn(),
    waitUntil: vi.fn(),
  } as unknown as NextFetchEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxy with installed Auth.js', () => {
  it('redirects an unauthenticated app request before active-team migration', async () => {
    const request = new NextRequest('https://timeline.test/app/timeline?view=all', {
      headers: {
        accept: 'text/html',
        cookie: `tl_active_team=${TEAM_ID}`,
      },
    });

    const response = await proxy(request, context());

    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toBe(
      'https://timeline.test/sign-in?callbackUrl=https%3A%2F%2Ftimeline.test%2Fapp%2Ftimeline%3Fview%3Dall',
    );
    expect(response?.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mocks.migrateActiveTeamCookie).not.toHaveBeenCalled();
  });
});
