import * as database from '@timeline/db';
import * as platformAdmin from '@timeline/shared/platform-admin';
import {
  operatorContext,
  registerOperatorContextResolver,
} from '@timeline/shared/platform-admin/runtime';
import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

// Request identity installs operator context explicitly, preserving real/effective actors.
const realDatabase = { ...database };
const realPlatformAdmin = { ...platformAdmin };
const request = { path: '/app/timeline', suspended: false };
const session = { user: { id: 'operator', email: 'operator@example.test', name: 'Operator' } };
await vi.mock(
  import.meta.resolve('@timeline/db'),
  () => ({ ...realDatabase, getDb: () => ({}) }),
  () => import('@timeline/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/platform-admin'),
  () => ({
    ...realPlatformAdmin,
    resolveImpersonation: () =>
      Promise.resolve({
        user: { id: 'member', name: 'Member', email: 'member@example.test' },
        session: { id: 'support-session', teamId: 'team' },
        readOnly: true,
      }),
  }),
  () => import('@timeline/shared/platform-admin'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth-base'),
  () => ({
    auth: () => Promise.resolve(session),
    handlers: {},
    signIn: vi.fn(),
    updateSession: vi.fn(),
    hasGitHubAuth: false,
    hasGoogleAuth: false,
  }),
  () => import('@/lib/auth-base'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ suspendedAt: request.suspended ? new Date() : null }]),
        }),
      }),
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({
    headers: () => Promise.resolve({ get: () => request.path }),
    cookies: () => Promise.resolve({ get: () => ({ value: 'support-token' }) }),
  }),
  () => import('next/headers'),
);
const { auth, getRequestIdentity } = await import('@/lib/auth');
beforeEach(() => {
  registerOperatorContextResolver(() => Promise.resolve(null));
  request.path = '/app/timeline';
  request.suspended = false;
});
const expectedOperator = {
  actorUserId: 'operator',
  actorEmail: 'operator@example.test',
  effectiveUserId: 'member',
  teamId: 'team',
  sessionId: 'support-session',
  readOnly: true,
};
describe('operator request context entrypoints', () => {
  it('installs context when auth resolves the effective member', async () => {
    expect(await operatorContext()).toBeNull();
    expect((await auth())?.user.id).toBe('member');
    expect(await operatorContext()).toEqual(expectedOperator);
  });
  it('also installs context for callers using request identity directly', async () => {
    expect((await getRequestIdentity()).session?.user.id).toBe('operator');
    expect(await operatorContext()).toEqual(expectedOperator);
  });
  it('keeps administrator routes on the real identity without impersonation context', async () => {
    request.path = '/app/admin';
    expect((await auth())?.user.id).toBe('operator');
    expect(await operatorContext()).toBeNull();
  });
  it('does not expose an effective identity for a suspended operator', async () => {
    request.suspended = true;
    expect(await auth()).toBeNull();
    expect(await operatorContext()).toBeNull();
  });
});
