import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

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

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      insert: fakes.dbInsert,
      update: fakes.dbUpdate,
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/request-ip'),
  () => ({ clientIpFromHeaders: fakes.clientIpFromHeaders }),
  () => import('@/lib/request-ip'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-action'),
  () => ({
    runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
  }),
  () => import('@/lib/sentry-action'),
);
await vi.mock(
  import.meta.resolve('@/lib/turnstile'),
  () => ({
    turnstileHostnameFromHeaders: fakes.turnstileHostnameFromHeaders,
    verifyTurnstileToken: fakes.verifyTurnstileToken,
  }),
  () => import('@/lib/turnstile'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({ headers: fakes.headers }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/env'),
  () => ({ getEnv: fakes.getEnv }),
  () => import('@timeline/shared/env'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  () => ({ sendMessage: fakes.sendMessage }),
  () => import('@timeline/shared/messaging'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/rate-limit'),
  () => ({
    RATE_LIMITS: { supportForm: { limit: 3, windowMs: 60_000 } },
    checkRateLimit: fakes.checkRateLimit,
    rateLimitKey: (...parts: (string | number | null | undefined)[]) =>
      `rl:${parts.filter(Boolean).join(':')}`,
  }),
  () => import('@timeline/shared/rate-limit'),
);

const { submitEnterpriseEnquiryAction } = await import('./enterprise.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

interface EnterpriseInsert {
  requestType: string;
  name: string;
  email: string;
  message: string;
  currentPage: string | null;
  userId: string | null;
  teamId: string | null;
  context: {
    kind: string;
    organization: string;
    teamSize: string;
    topics: string[];
    pricingContext: string | null;
    teamRole: string | null;
    surface: string | null;
    errorReference: string | null;
    release: string | null;
    userAgent: string | null;
  };
}

function form(overrides: Record<string, string | string[]> = {}): FormData {
  const fd = new FormData();
  const values: Record<string, string | string[]> = {
    name: 'Ada Lovelace',
    email: 'ADA@ACME.TEST',
    organization: 'Acme Labs',
    teamSize: '51_200',
    topics: ['procurement', 'sso'],
    message: 'We need a security review and SSO before procurement can proceed.',
    pricingContext: 'from=pricing, plan=business, members=40',
    company: '',
    'cf-turnstile-response': 'turnstile-token',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const entry of value) fd.append(key, entry);
    } else {
      fd.set(key, value);
    }
  }
  return fd;
}

function headersFixture(): Headers {
  return new Headers({
    host: 'timeline.test',
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

function enterpriseInsert(value: unknown): EnterpriseInsert {
  if (!value || typeof value !== 'object' || !('context' in value)) {
    throw new Error('expected enterprise insert payload');
  }
  return value as EnterpriseInsert;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.headers.mockResolvedValue(headersFixture());
  fakes.clientIpFromHeaders.mockReturnValue('203.0.113.10');
  fakes.turnstileHostnameFromHeaders.mockReturnValue('timeline.test');
  fakes.checkRateLimit.mockResolvedValue({ ok: true, remaining: 2 });
  fakes.verifyTurnstileToken.mockResolvedValue(true);
  fakes.auth.mockResolvedValue({
    user: { id: USER_ID, name: 'Ada', email: 'ada@acme.test' },
  });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: {
      teamId: TEAM_ID,
      teamName: 'Acme Labs',
      teamSlug: 'acme-labs',
      role: 'owner',
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

describe('enterprise enquiry action', () => {
  it('rejects invalid payloads before rate limits or verification', async () => {
    const shortMessage = await submitEnterpriseEnquiryAction({}, form({ message: 'too short' }));
    expect(shortMessage.error).toBeTruthy();
    expect(fakes.headers).not.toHaveBeenCalled();

    const missingTopics = await submitEnterpriseEnquiryAction({}, form({ topics: [] }));
    expect(missingTopics.error).toBeTruthy();

    const honeypot = await submitEnterpriseEnquiryAction({}, form({ company: 'spam.example' }));
    expect(honeypot.error).toBeTruthy();
    expect(fakes.dbInsert).not.toHaveBeenCalled();
  });

  it('rejects failed Turnstile verification before persistence', async () => {
    fakes.verifyTurnstileToken.mockResolvedValueOnce(false);

    await expect(submitEnterpriseEnquiryAction({}, form())).resolves.toEqual({
      error: 'Verification failed. Refresh and try again.',
    });
    expect(fakes.verifyTurnstileToken).toHaveBeenCalledWith({
      token: 'turnstile-token',
      remoteIp: '203.0.113.10',
      expectedAction: 'support',
      expectedHostname: 'timeline.test',
    });
    expect(fakes.dbInsert).not.toHaveBeenCalled();
  });

  it('saves an enterprise-tagged sales request and emails support', async () => {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    okInsertChain(inserts);
    okUpdateChain(updates);

    await expect(submitEnterpriseEnquiryAction({}, form())).resolves.toEqual({
      ok: true,
      requestReference: REQUEST_ID,
    });

    const inserted = enterpriseInsert(inserts[0]);
    expect(inserted).toMatchObject({
      requestType: 'sales',
      name: 'Ada Lovelace',
      email: 'ada@acme.test',
      currentPage: '/contact/enterprise',
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    expect(inserted.message).toContain('Enterprise enquiry');
    expect(inserted.message).toContain('Company: Acme Labs');
    expect(inserted.message).toContain('Topics: Procurement, SSO');
    expect(inserted.message).toContain('Pricing context: from=pricing, plan=business, members=40');
    expect(inserted.context).toEqual({
      kind: 'enterprise',
      organization: 'Acme Labs',
      teamSize: '51_200',
      topics: ['procurement', 'sso'],
      pricingContext: 'from=pricing, plan=business, members=40',
      teamRole: 'owner',
      surface: null,
      errorReference: null,
      release: 'release-sha',
      userAgent: 'Vitest Browser',
    });
    expect(fakes.sendMessage).toHaveBeenCalledWith(
      'support_request',
      expect.objectContaining({
        supportEmail: 'support@timeline.test',
        requestId: REQUEST_ID,
        requestType: 'sales',
        tag: 'enterprise',
        teamId: TEAM_ID,
        userId: USER_ID,
      }),
      expect.objectContaining({
        dedupeKey: `support_request:enterprise:${REQUEST_ID}`,
      }),
    );
    expect(updates[0]).toMatchObject({ emailError: null });
  });

  it('returns a reference when email delivery is unavailable', async () => {
    const updates: unknown[] = [];
    okUpdateChain(updates);
    fakes.getEnv.mockReturnValueOnce({});

    await expect(submitEnterpriseEnquiryAction({}, form())).resolves.toEqual({
      ok: true,
      requestReference: REQUEST_ID,
      warning: 'Your enquiry was saved, but email delivery is currently unavailable.',
    });
    expect(updates[0]).toMatchObject({
      emailError: 'Support delivery is not configured.',
    });
    expect(fakes.sendMessage).not.toHaveBeenCalled();
  });
});
