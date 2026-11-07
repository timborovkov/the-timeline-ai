import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type * as PlatformAdminRuntime from '@timeline/shared/platform-admin/runtime';

const ACTIVE_TEAM = '11111111-1111-4111-8111-111111111111';
const SUSPENDED_TEAM = '22222222-2222-4222-8222-222222222222';
const TERMINATED_TEAM = '33333333-3333-4333-8333-333333333333';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const fakes = vi.hoisted(() => ({
  operatorContext: vi.fn(),
  cookies: vi.fn(),
  select: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared/platform-admin/runtime'),
  async (importOriginal) => ({
    ...(await importOriginal<typeof PlatformAdminRuntime>()),
    operatorContext: fakes.operatorContext,
  }),
  () => import('@timeline/shared/platform-admin/runtime'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({ cookies: fakes.cookies }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: { select: fakes.select } }),
  () => import('@/lib/db'),
);

const { resolveActiveTeam } = await import('@/lib/active-team');
const { serializeActiveTeamCookie } = await import('@/lib/active-team-cookie');

function membershipRow(input: {
  teamId: string;
  teamName: string;
  securityState: string | null;
  createdAt: string;
}) {
  return {
    teamId: input.teamId,
    teamName: input.teamName,
    teamSlug: input.teamName.toLowerCase().replaceAll(' ', '-'),
    role: 'member' as const,
    createdAt: new Date(input.createdAt),
    securityState: input.securityState,
  };
}

function selectChain(rows: unknown[]) {
  const thenable = {
    orderBy: vi.fn(() => Promise.resolve(rows)),
    then: Promise.resolve(rows).then.bind(Promise.resolve(rows)),
  };
  const afterJoin = {
    innerJoin: vi.fn(() => afterJoin),
    leftJoin: vi.fn(() => afterJoin),
    where: vi.fn(() => thenable),
  };
  return { from: vi.fn(() => afterJoin) };
}

describe('resolveActiveTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.operatorContext.mockResolvedValue(null);
    fakes.cookies.mockResolvedValue({ get: () => undefined });
    fakes.select.mockReturnValue(
      selectChain([
        membershipRow({
          teamId: SUSPENDED_TEAM,
          teamName: 'Suspended Co',
          securityState: 'suspended',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        membershipRow({
          teamId: ACTIVE_TEAM,
          teamName: 'Active Co',
          securityState: 'normal',
          createdAt: '2026-02-01T00:00:00.000Z',
        }),
        membershipRow({
          teamId: TERMINATED_TEAM,
          teamName: 'Terminated Co',
          securityState: 'terminated',
          createdAt: '2026-03-01T00:00:00.000Z',
        }),
      ]),
    );
  });

  it('omits suspended and terminated workspaces from the selector even if the cookie names them', async () => {
    fakes.cookies.mockResolvedValue({
      get: () => ({ value: serializeActiveTeamCookie(SUSPENDED_TEAM) }),
    });

    await expect(resolveActiveTeam(USER_ID)).resolves.toEqual({
      active: {
        teamId: ACTIVE_TEAM,
        teamName: 'Active Co',
        teamSlug: 'active-co',
        role: 'member',
      },
      memberships: [
        {
          teamId: ACTIVE_TEAM,
          teamName: 'Active Co',
          teamSlug: 'active-co',
          role: 'member',
        },
      ],
    });
  });

  it('keeps a read-only impersonated suspended workspace as the only selectable team', async () => {
    fakes.operatorContext.mockResolvedValue({
      actorUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      actorEmail: 'admin@example.test',
      effectiveUserId: USER_ID,
      teamId: SUSPENDED_TEAM,
      sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      readOnly: true,
    });

    await expect(resolveActiveTeam(USER_ID)).resolves.toEqual({
      active: {
        teamId: SUSPENDED_TEAM,
        teamName: 'Suspended Co',
        teamSlug: 'suspended-co',
        role: 'member',
      },
      memberships: [
        {
          teamId: SUSPENDED_TEAM,
          teamName: 'Suspended Co',
          teamSlug: 'suspended-co',
          role: 'member',
        },
      ],
    });
  });
});
