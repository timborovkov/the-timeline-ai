import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Member-managed calendar subscriptions are bearer URLs, so the API must guard
// membership while revealing plaintext only at create/reset time.
const fakes = vi.hoisted<{
  auth: ReturnType<typeof vi.fn>;
  resolveActiveTeam: ReturnType<typeof vi.fn>;
  requireMembership: ReturnType<typeof vi.fn>;
  mintToken: ReturnType<typeof vi.fn>;
  reportCaughtError: ReturnType<typeof vi.fn>;
  loggerError: ReturnType<typeof vi.fn>;
  selectRows: unknown[];
  insertValues: unknown[];
  conflictSet: unknown;
  returningRows: unknown[];
  deleted: boolean;
  insertError: Error | null;
}>(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  mintToken: vi.fn(),
  reportCaughtError: vi.fn(),
  loggerError: vi.fn(),
  selectRows: [],
  insertValues: [],
  conflictSet: null,
  returningRows: [],
  deleted: false,
  insertError: null,
}));

vi.mock('@timeline/db', () => ({
  teamCalendarSubscriptions: {
    table: 'team_calendar_subscriptions',
    teamId: 'team_id',
    userId: 'user_id',
    tokenPrefix: 'token_prefix',
    lastUsedAt: 'last_used_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: fakes.loggerError }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ requireMembership: fakes.requireMembership }),
}));
vi.mock('@timeline/shared/calendar', () => ({
  mintCalendarSubscriptionToken: fakes.mintToken,
}));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockImplementation(() => Promise.resolve(fakes.selectRows)),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        fakes.insertValues.push({ table, value });
        return {
          onConflictDoUpdate: (input: unknown) => {
            fakes.conflictSet = input;
            return {
              returning: vi.fn().mockImplementation(() => {
                if (fakes.insertError) throw fakes.insertError;
                return fakes.returningRows;
              }),
            };
          },
        };
      },
    }),
    delete: (table: unknown) => ({
      where: (where: unknown) => {
        fakes.deleted = true;
        return Promise.resolve({ table, where });
      },
    }),
  },
}));

const { DELETE, GET, POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const ORIGINAL_AUTH_URL = process.env.AUTH_URL;
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;
const ORIGINAL_VERCEL_URL = process.env.VERCEL_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_URL = 'https://timeline.test';
  delete process.env.NEXTAUTH_URL;
  delete process.env.VERCEL_URL;
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('member');
  fakes.mintToken.mockReturnValue({
    plaintext: 'tlcal_plaintext_once',
    hash: 'hashed',
    prefix: 'tlcal_pre',
  });
  fakes.selectRows = [
    {
      tokenPrefix: 'tlcal_old',
      lastUsedAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  ];
  fakes.returningRows = [
    {
      tokenPrefix: 'tlcal_pre',
      lastUsedAt: null,
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    },
  ];
  fakes.insertValues = [];
  fakes.conflictSet = null;
  fakes.deleted = false;
  fakes.insertError = null;
});

afterEach(() => {
  if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  if (ORIGINAL_NEXTAUTH_URL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
});

describe('/api/team/calendar-subscription', () => {
  it('guards auth, active team, and membership', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await GET();
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await POST(
      new Request('https://timeline.test/api/team/calendar-subscription', { method: 'POST' }),
    );
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });

    fakes.requireMembership.mockRejectedValueOnce(new Error('not a member'));
    const forbidden = await DELETE();
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('lists subscription metadata without returning token hashes or plaintext URLs', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription: {
        prefix: 'tlcal_old',
        lastUsedAt: '2026-06-01T00:00:00.000Z',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    });
  });

  it('creates or resets the current member URL and returns plaintext only once', async () => {
    const response = await POST(
      new Request('https://timeline.test/api/team/calendar-subscription', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      subscription: {
        prefix: 'tlcal_pre',
        lastUsedAt: null,
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
      url: 'https://timeline.test/api/calendar/feed/tlcal_plaintext_once.ics',
    });
    expect(fakes.insertValues[0]).toMatchObject({
      value: {
        teamId: TEAM_ID,
        userId: USER_ID,
        tokenHash: 'hashed',
        tokenPrefix: 'tlcal_pre',
      },
    });
    expect(fakes.conflictSet).toMatchObject({
      set: { tokenHash: 'hashed', tokenPrefix: 'tlcal_pre', lastUsedAt: null },
    });
  });

  it('uses the canonical app origin instead of an internal request host', async () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';

    const response = await POST(
      new Request('https://0.0.0.0:8080/api/team/calendar-subscription', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: 'https://thetimeline.cc/api/calendar/feed/tlcal_plaintext_once.ics',
    });
  });

  it('does not rotate the token when the canonical app origin is invalid', async () => {
    process.env.AUTH_URL = 'not-a-url';

    const response = await POST(
      new Request('https://0.0.0.0:8080/api/team/calendar-subscription', { method: 'POST' }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'create_failed' });
    expect(fakes.insertValues).toEqual([]);
    expect(fakes.loggerError).toHaveBeenCalled();
    expect(fakes.reportCaughtError).toHaveBeenCalled();
  });

  it('deletes the member subscription', async () => {
    const response = await DELETE();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.deleted).toBe(true);
  });

  it('maps upsert failures without leaking token material', async () => {
    fakes.insertError = new Error('db down');

    const response = await POST(
      new Request('https://timeline.test/api/team/calendar-subscription', { method: 'POST' }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'create_failed' });
    expect(fakes.loggerError).toHaveBeenCalled();
    expect(fakes.reportCaughtError).toHaveBeenCalled();
  });
});
