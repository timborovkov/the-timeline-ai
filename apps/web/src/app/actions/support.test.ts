import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  headers: vi.fn(),
  getEnv: vi.fn(),
  checkRateLimit: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  sendMessage: vi.fn(),
  dbInsert: vi.fn(),
  dbUpdate: vi.fn(),
  clientIpFromHeaders: vi.fn(),
  turnstileHostnameFromHeaders: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({
  db: {
    insert: fakes.dbInsert,
    update: fakes.dbUpdate,
  },
}));
vi.mock('@/lib/request-ip', () => ({ clientIpFromHeaders: fakes.clientIpFromHeaders }));
vi.mock('@/lib/sentry-action', () => ({
  runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/turnstile', () => ({
  turnstileHostnameFromHeaders: fakes.turnstileHostnameFromHeaders,
  verifyTurnstileToken: fakes.verifyTurnstileToken,
}));
vi.mock('next/headers', () => ({ headers: fakes.headers }));
vi.mock('@timeline/shared/env', () => ({ getEnv: fakes.getEnv }));
vi.mock('@timeline/shared/messaging', () => ({ sendMessage: fakes.sendMessage }));
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { supportForm: { limit: 3, windowMs: 60_000 } },
  checkRateLimit: fakes.checkRateLimit,
  rateLimitKey: (...parts: (string | number | null | undefined)[]) =>
    `rl:${parts.filter(Boolean).join(':')}`,
}));

const { submitSupportRequestAction } = await import('./support.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

interface SupportInsert {
  requestType: string;
  name: string;
  email: string;
  message: string;
  currentPage: string | null;
  userId: string | null;
  teamId: string | null;
  context: {
    teamRole: string | null;
    surface: string | null;
    errorReference: string | null;
    release: string | null;
    userAgent: string | null;
  };
}

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values = {
    requestType: 'technical_support',
    name: 'Ada Lovelace',
    email: 'ADA@EXAMPLE.TEST',
    message: 'The export page fails after I click the retry button.',
    surface: 'team_integrations',
    errorReference: 'sentry-reference',
    company: '',
    'cf-turnstile-response': 'turnstile-token',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function headersFixture(): Headers {
  return new Headers({
    host: 'timeline.test',
    referer: 'https://timeline.test/app/team?token=must-not-persist',
    'user-agent': 'Vitest Browser',
    'x-forwarded-for': '203.0.113.10',
  });
}

function okInsertChain(records: unknown[], id: string | null = REQUEST_ID): void {
  fakes.dbInsert.mockReturnValue({
    values: vi.fn((value: unknown) => {
      records.push(value);
      return {
        returning: vi.fn().mockResolvedValue(id ? [{ id }] : []),
      };
    }),
  });
}

function okUpdateChain(records: unknown[]): void {
  fakes.dbUpdate.mockReturnValue({
    set: vi.fn((value: unknown) => {
      records.push(value);
      return { where: vi.fn(() => Promise.resolve()) };
    }),
  });
}

function recordedRateLimitKey(index: number): string {
  const call = fakes.checkRateLimit.mock.calls.at(index) as unknown[] | undefined;
  const input = call?.[0];
  if (
    input === null ||
    typeof input !== 'object' ||
    !('key' in input) ||
    typeof input.key !== 'string'
  ) {
    throw new TypeError(`Expected rate-limit call ${index} to include a string key.`);
  }
  return input.key;
}

function supportInsert(value: unknown): SupportInsert {
  if (!value || typeof value !== 'object' || !('context' in value)) {
    throw new Error('expected support insert payload');
  }
  return value as SupportInsert;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.headers.mockResolvedValue(headersFixture());
  fakes.clientIpFromHeaders.mockReturnValue('203.0.113.10');
  fakes.turnstileHostnameFromHeaders.mockReturnValue('timeline.test');
  fakes.checkRateLimit.mockResolvedValue({ ok: true, remaining: 2 });
  fakes.verifyTurnstileToken.mockResolvedValue(true);
  fakes.auth.mockResolvedValue({
    user: { id: USER_ID, name: 'Ada', email: 'ada@example.test' },
  });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: {
      teamId: TEAM_ID,
      teamName: 'Acme Labs',
      teamSlug: 'acme-labs',
      role: 'admin',
    },
  });
  fakes.getEnv.mockReturnValue({
    SUPPORT_EMAIL: 'support@timeline.test',
    SENTRY_RELEASE: 'release-sha',
  });
  fakes.sendMessage.mockResolvedValue({ ok: true });
  okInsertChain([]);
  okUpdateChain([]);
});

describe('support request action', () => {
  it('rejects invalid form payloads before rate limits or verification', async () => {
    const result = await submitSupportRequestAction({}, form({ message: 'too short' }));

    expect(result.error).toBeTruthy();
    expect(fakes.headers).not.toHaveBeenCalled();
    expect(fakes.checkRateLimit).not.toHaveBeenCalled();
    expect(fakes.verifyTurnstileToken).not.toHaveBeenCalled();
    expect(fakes.dbInsert).not.toHaveBeenCalled();
  });

  it('rejects raw URLs and arbitrary error context before reading request metadata', async () => {
    const result = await submitSupportRequestAction(
      {},
      form({
        surface: 'https://timeline.test/app/team?token=secret',
        errorReference: 'reference?token=secret',
      }),
    );

    expect(result.error).toBeTruthy();
    expect(fakes.headers).not.toHaveBeenCalled();
    expect(fakes.dbInsert).not.toHaveBeenCalled();
  });

  it('applies IP and identity rate limits before saving', async () => {
    fakes.checkRateLimit.mockResolvedValueOnce({ ok: false, retryAfterMs: 3_200 });

    await expect(submitSupportRequestAction({}, form())).resolves.toEqual({
      error: 'Too many requests. Try again in 4s.',
    });
    expect(fakes.verifyTurnstileToken).not.toHaveBeenCalled();
    expect(fakes.dbInsert).not.toHaveBeenCalled();

    fakes.checkRateLimit
      .mockResolvedValueOnce({ ok: true, remaining: 2 })
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 9_100 });
    await expect(submitSupportRequestAction({}, form())).resolves.toEqual({
      error: 'Too many requests. Try again in 10s.',
    });
    expect(fakes.dbInsert).not.toHaveBeenCalled();
  });

  it('rejects failed Turnstile verification before auth or persistence', async () => {
    fakes.verifyTurnstileToken.mockResolvedValueOnce(false);

    await expect(submitSupportRequestAction({}, form())).resolves.toEqual({
      error: 'Verification failed. Refresh and try again.',
    });

    expect(fakes.verifyTurnstileToken).toHaveBeenCalledWith({
      token: 'turnstile-token',
      remoteIp: '203.0.113.10',
      expectedAction: 'support',
      expectedHostname: 'timeline.test',
    });
    expect(fakes.auth).not.toHaveBeenCalled();
    expect(fakes.dbInsert).not.toHaveBeenCalled();
  });

  it('saves authenticated team context, sends support email, and marks delivery success', async () => {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    okInsertChain(inserts);
    okUpdateChain(updates);

    await expect(submitSupportRequestAction({}, form())).resolves.toEqual({
      ok: true,
      requestReference: REQUEST_ID,
    });

    const inserted = supportInsert(inserts[0]);
    expect(inserted).toMatchObject({
      requestType: 'technical_support',
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      message: 'The export page fails after I click the retry button.',
      currentPage: '/app/team/integrations',
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    expect(inserted.context).toEqual({
      teamRole: 'admin',
      surface: 'team_integrations',
      errorReference: 'sentry-reference',
      release: 'release-sha',
      userAgent: 'Vitest Browser',
    });
    expect(inserted.context).not.toHaveProperty('ip');
    expect(inserted.context).not.toHaveProperty('referer');
    expect(JSON.stringify(inserted)).not.toContain('must-not-persist');
    const ipRateLimitKey = recordedRateLimitKey(0);
    expect(ipRateLimitKey).toMatch(/^rl:support:ip:[A-Za-z0-9_-]{43}$/);
    expect(ipRateLimitKey).not.toContain('203.0.113.10');
    const accountRateLimitKey = recordedRateLimitKey(1);
    expect(accountRateLimitKey).toMatch(/^rl:support:identity:[A-Za-z0-9_-]{43}$/);
    expect(accountRateLimitKey).not.toContain(USER_ID);
    expect(fakes.sendMessage).toHaveBeenCalledWith(
      'support_request',
      expect.objectContaining({
        supportEmail: 'support@timeline.test',
        requestId: REQUEST_ID,
        surface: 'team_integrations',
        errorReference: 'sentry-reference',
        release: 'release-sha',
        teamId: TEAM_ID,
        userId: USER_ID,
        teamRole: 'admin',
      }),
      expect.objectContaining({
        teamId: TEAM_ID,
        userId: USER_ID,
        dedupeKey: `support_request:${REQUEST_ID}`,
      }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ emailError: null });
    expect(updates[0]).toHaveProperty('emailSentAt');
  });

  it('saves anonymous requests with email identity when no user is signed in', async () => {
    const inserts: unknown[] = [];
    okInsertChain(inserts);
    fakes.auth.mockResolvedValueOnce(null);

    await expect(
      submitSupportRequestAction({}, form({ surface: '', errorReference: '' })),
    ).resolves.toEqual({ ok: true, requestReference: REQUEST_ID });

    const inserted = supportInsert(inserts[0]);
    expect(inserted).toMatchObject({
      userId: null,
      teamId: null,
      currentPage: null,
    });
    expect(inserted.context).toEqual({
      teamRole: null,
      surface: null,
      errorReference: null,
      release: 'release-sha',
      userAgent: 'Vitest Browser',
    });
    expect(fakes.resolveActiveTeam).not.toHaveBeenCalled();
    const identityRateLimitKey = recordedRateLimitKey(-1);
    expect(identityRateLimitKey).toMatch(/^rl:support:identity:[A-Za-z0-9_-]{43}$/);
    expect(identityRateLimitKey).not.toContain('ada@example.test');
  });

  it('returns a reference after saving even when email delivery is unavailable', async () => {
    const missingConfigUpdates: unknown[] = [];
    okUpdateChain(missingConfigUpdates);
    fakes.getEnv.mockReturnValueOnce({});

    const missingConfig = await submitSupportRequestAction({}, form());
    expect(missingConfig).toEqual({
      ok: true,
      requestReference: REQUEST_ID,
      warning: 'Your request was saved, but email delivery is currently unavailable.',
    });
    expect(missingConfigUpdates[0]).toMatchObject({
      emailError: 'Support delivery is not configured.',
    });
    expect(fakes.sendMessage).not.toHaveBeenCalled();

    const sendFailureUpdates: unknown[] = [];
    okUpdateChain(sendFailureUpdates);
    fakes.sendMessage.mockResolvedValueOnce({ ok: false, error: 'smtp_down' });

    const sendFailure = await submitSupportRequestAction({}, form());
    expect(sendFailure).toEqual({
      ok: true,
      requestReference: REQUEST_ID,
      warning: 'Your request was saved, but email delivery is currently unavailable.',
    });
    expect(sendFailureUpdates[0]).toMatchObject({ emailError: 'smtp_down' });
  });
});
