import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

const billingFakes = vi.hoisted(() => ({
  reserveEmailUnits: vi.fn(),
  releaseEmailUnits: vi.fn(),
  settleEmailUnits: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('#src/billing/runtime.js'),
  async () => ({
    ...(await import('#src/billing/runtime.js')),
    reserveEmailUnits: billingFakes.reserveEmailUnits,
    releaseEmailUnits: billingFakes.releaseEmailUnits,
    settleEmailUnits: billingFakes.settleEmailUnits,
  }),
  () => import('#src/billing/runtime.js'),
);

const { resetEnvForTests } = await import('#src/env.js');
const { messagingInternals, sendDailyDigest, sendMessage, shouldMeterWorkspaceEmail } =
  await import('#src/messaging/delivery.js');
const { renderMessage } = await import('#src/messaging/templates.js');

function fakeDeliveryDb(
  existing: { id: string; status: string; dedupeKey: string } | null,
  opts: { claimFailed?: boolean; claimPending?: boolean } = {},
) {
  const updates: unknown[] = [];
  return {
    updates,
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(
              existing
                ? [
                    {
                      id: existing.id,
                      status: existing.status,
                      metadata: {
                        email_payload: {
                          from: 'hello@example.test',
                          to: ['tim@example.test'],
                          subject: 'Stored email',
                          text: 'Stored text',
                          html: '<p>Stored text</p>',
                          tags: [],
                        },
                      },
                    },
                  ]
                : [],
            ),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi
                .fn()
                .mockResolvedValue(
                  (existing?.status === 'failed' && (opts.claimFailed ?? true)) ||
                    (existing?.status === 'pending' && (opts.claimPending ?? false))
                    ? [{ id: existing.id }]
                    : [],
                ),
            })),
          };
        }),
      })),
    },
  };
}

function fakeDailyDigestDbWithPendingDelivery() {
  let selectCount = 0;
  const updates: unknown[] = [];
  const payload = {
    teamName: 'Timeline',
    userName: 'Tim',
    windowStart: '2026-06-13T12:00:00.000Z',
    windowEnd: '2026-06-14T12:00:00.000Z',
    summary: 'Quiet day. One decision and no blockers.',
    pendingApprovals: 0,
    eventCount: 1,
    sourceDistribution: {},
    objectChangesByType: {},
    newTeamMembers: [],
    tasks: [],
    upcomingCalendar: [],
    links: [],
  };
  return {
    updates,
    db: {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 2) {
          const chain = {
            innerJoin: vi.fn(() => chain),
            leftJoin: vi.fn(() => chain),
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  email: 'current@example.test',
                  removedAt: null,
                  dailyDigestEnabled: true,
                },
              ]),
            })),
          };
          return { from: vi.fn(() => chain) };
        }
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => {
              const rows =
                selectCount === 1
                  ? [
                      {
                        id: 'digest-1',
                        teamId: 'team-1',
                        userId: 'user-1',
                        windowEnd: new Date('2026-06-14T12:00:00.000Z'),
                        payload,
                      },
                    ]
                  : selectCount === 3
                    ? [{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }]
                    : selectCount === 4
                      ? []
                      : [{ id: 'delivery-1', status: 'pending' }];
              const limited = { limit: vi.fn().mockResolvedValue(rows) };
              return { ...limited, orderBy: vi.fn(() => limited) };
            }),
          })),
        };
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([]),
            })),
          };
        }),
      })),
    },
  };
}

const OLD_ENV = process.env;

describe('Resend messaging adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    billingFakes.reserveEmailUnits.mockReset();
    billingFakes.releaseEmailUnits.mockReset();
    billingFakes.settleEmailUnits.mockReset();
    billingFakes.reserveEmailUnits.mockResolvedValue({ ok: true });
    billingFakes.releaseEmailUnits.mockResolvedValue(undefined);
    billingFakes.settleEmailUnits.mockResolvedValue({ ok: true });
    process.env = { ...OLD_ENV };
    resetEnvForTests();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    resetEnvForTests();
    vi.restoreAllMocks();
  });

  it('fails visibly when outbound email is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.TRANSACTIONAL_EMAIL_FROM;

    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });

    await expect(messagingInternals.sendResendEmail(message)).resolves.toEqual({
      ok: false,
      error: 'Outbound email is not configured',
      retryable: false,
    });
  });

  it('returns the provider message id on success', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'resend-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });

    await expect(messagingInternals.sendResendEmail(message, fetchMock)).resolves.toEqual({
      ok: true,
      providerMessageId: 'resend-id',
    });
  });

  it('uses the legacy invite sender when the shared sender is not set', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    delete process.env.TRANSACTIONAL_EMAIL_FROM;
    process.env.INVITE_EMAIL_FROM = 'Timeline Invites <invites@example.test>';
    const requests: RequestInit[] = [];
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'resend-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const message = renderMessage('team_invite', {
      to: 'tim@example.test',
      inviterName: 'Tim',
      teamName: 'Timeline',
      role: 'member',
      inviteUrl: 'https://timeline.test/accept-invite/token',
      expiresAt: new Date('2026-06-15T12:00:00Z'),
    });

    await expect(messagingInternals.sendResendEmail(message, fetchMock)).resolves.toEqual({
      ok: true,
      providerMessageId: 'resend-id',
    });
    const body = requests[0]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toMatchObject({
      from: 'Timeline Invites <invites@example.test>',
    });
  });

  it('maps provider errors into short delivery errors', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: 'validation_error', message: 'Bad recipient' }), {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });

    await expect(messagingInternals.sendResendEmail(message, fetchMock)).resolves.toEqual({
      ok: false,
      error: 'Resend request failed: validation_error',
      retryable: false,
    });
  });

  it('marks inactive Resend recipients as non-retryable', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const inactiveMessage =
      'You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: tim@example.test. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression.';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: 'validation_error', message: inactiveMessage }), {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });

    await expect(messagingInternals.sendResendEmail(message, fetchMock)).resolves.toEqual({
      ok: false,
      error: 'Resend request failed: validation_error',
      retryable: false,
    });
  });

  it('keeps Resend quota exhaustion retryable', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            name: 'daily_quota_exceeded',
            message: 'Not allowed to send. Your account has run out of credits.',
          }),
          {
            status: 429,
            statusText: 'Unprocessable Entity',
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });

    await expect(messagingInternals.sendResendEmail(message, fetchMock)).resolves.toEqual({
      ok: false,
      error: 'Resend request failed: daily_quota_exceeded',
      retryable: true,
    });
  });

  it('keeps Resend 5xx failures retryable', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ name: 'application_error', message: 'Temporary upstream failure' }),
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });

    await expect(messagingInternals.sendResendEmail(message, fetchMock)).resolves.toEqual({
      ok: false,
      error: 'Resend request failed: application_error',
      retryable: true,
    });
  });

  it('sends Resend fields and stable idempotency keys without leaking unsupported metadata', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'hello@example.test';
    const request = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(Response.json({ id: 'sent' })),
    );
    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });
    message.replyTo = 'support@example.test';
    message.metadata = { message_intent: 'welcome', private_text: 'do not send this text' };
    await messagingInternals.sendResendEmail(message, request, 'delivery-42');
    await messagingInternals.sendResendEmail(message, request, 'delivery-42');
    const first = request.mock.calls[0]?.[1];
    const headers = new Headers(first?.headers);
    expect(headers.get('authorization')).toBe('Bearer re_test');
    expect(headers.get('idempotency-key')).toStartWith('timeline-');
    expect(first?.headers).toEqual(request.mock.calls[1]?.[1]?.headers);
    expect(JSON.parse(first?.body as string)).toMatchObject({
      from: 'hello@example.test',
      to: ['tim@example.test'],
      reply_to: 'support@example.test',
      tags: [{ name: 'message_intent', value: 'welcome' }],
    });
    expect(first?.body as string).not.toContain('private_text');
  });

  it('retries a failed deduped delivery instead of skipping Resend', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'retry-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { db, updates } = fakeDeliveryDb({
      id: 'delivery-1',
      status: 'failed',
      dedupeKey: 'welcome:user-1',
    });

    await expect(
      sendMessage(
        'welcome',
        {
          to: 'tim@example.test',
          name: 'Tim',
          teamName: 'Timeline',
          dashboardUrl: 'https://timeline.test/app',
        },
        { db: db as never, dedupeKey: 'welcome:user-1', fetch: fetchMock },
      ),
    ).resolves.toEqual({
      ok: true,
      deliveryId: 'delivery-1',
      providerMessageId: 'retry-id',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      subject: 'Stored email',
      text: 'Stored text',
    });
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
    expect(updates).toContainEqual(
      expect.objectContaining({ status: 'sent', providerMessageId: 'retry-id' }),
    );
  });

  it('does not send when a deduped delivery is already pending', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn();
    const { db, updates } = fakeDeliveryDb({
      id: 'delivery-1',
      status: 'pending',
      dedupeKey: 'welcome:user-1',
    });

    await expect(
      sendMessage(
        'welcome',
        {
          to: 'tim@example.test',
          name: 'Tim',
          teamName: 'Timeline',
          dashboardUrl: 'https://timeline.test/app',
        },
        { db: db as never, dedupeKey: 'welcome:user-1', fetch: fetchMock },
      ),
    ).resolves.toEqual({
      ok: false,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'pending',
      error: 'Delivery is already pending.',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
  });

  it('retries a stale pending deduped delivery', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'pending-retry-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { db, updates } = fakeDeliveryDb(
      {
        id: 'delivery-1',
        status: 'pending',
        dedupeKey: 'welcome:user-1',
      },
      { claimPending: true },
    );

    await expect(
      sendMessage(
        'welcome',
        {
          to: 'tim@example.test',
          name: 'Tim',
          teamName: 'Timeline',
          dashboardUrl: 'https://timeline.test/app',
        },
        { db: db as never, dedupeKey: 'welcome:user-1', fetch: fetchMock },
      ),
    ).resolves.toEqual({
      ok: true,
      deliveryId: 'delivery-1',
      providerMessageId: 'pending-retry-id',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
    expect(updates).toContainEqual(
      expect.objectContaining({ status: 'sent', providerMessageId: 'pending-retry-id' }),
    );
  });

  it('does not send when another retry already claimed a failed delivery', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn();
    const { db, updates } = fakeDeliveryDb(
      {
        id: 'delivery-1',
        status: 'failed',
        dedupeKey: 'welcome:user-1',
      },
      { claimFailed: false },
    );

    await expect(
      sendMessage(
        'welcome',
        {
          to: 'tim@example.test',
          name: 'Tim',
          teamName: 'Timeline',
          dashboardUrl: 'https://timeline.test/app',
        },
        { db: db as never, dedupeKey: 'welcome:user-1', fetch: fetchMock },
      ),
    ).resolves.toEqual({
      ok: false,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'pending',
      error: 'Delivery is already pending.',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
  });

  it('skips Resend only when the deduped delivery is already sent', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn();
    const { db, updates } = fakeDeliveryDb({
      id: 'delivery-1',
      status: 'sent',
      dedupeKey: 'welcome:user-1',
    });

    await expect(
      sendMessage(
        'welcome',
        {
          to: 'tim@example.test',
          name: 'Tim',
          teamName: 'Timeline',
          dashboardUrl: 'https://timeline.test/app',
        },
        { db: db as never, dedupeKey: 'welcome:user-1', fetch: fetchMock },
      ),
    ).resolves.toEqual({
      ok: true,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'sent',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('records Resend success before billing settlement and does not resend', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    billingFakes.settleEmailUnits.mockRejectedValue(new Error('ledger down'));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'sent-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const first = fakeDeliveryDb({
      id: 'delivery-1',
      status: 'failed',
      dedupeKey: 'welcome:user-1',
    });

    await expect(
      sendMessage(
        'welcome',
        {
          to: 'tim@example.test',
          name: 'Tim',
          teamName: 'Timeline',
          dashboardUrl: 'https://timeline.test/app',
        },
        {
          db: first.db as never,
          teamId: 'team-1',
          dedupeKey: 'welcome:user-1',
          fetch: fetchMock,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      deliveryId: 'delivery-1',
      providerMessageId: 'sent-id',
    });
    expect(first.updates).toContainEqual(
      expect.objectContaining({ status: 'sent', providerMessageId: 'sent-id' }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();

    const second = fakeDeliveryDb({
      id: 'delivery-1',
      status: 'sent',
      dedupeKey: 'welcome:user-1',
    });
    await expect(
      sendMessage(
        'welcome',
        {
          to: 'tim@example.test',
          name: 'Tim',
          teamName: 'Timeline',
          dashboardUrl: 'https://timeline.test/app',
        },
        {
          db: second.db as never,
          teamId: 'team-1',
          dedupeKey: 'welcome:user-1',
          fetch: fetchMock,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'sent',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(billingFakes.settleEmailUnits).toHaveBeenCalledTimes(2);
  });

  it('does not mark a digest sent when its delivery is skipped because another send is pending', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn();
    const { db, updates } = fakeDailyDigestDbWithPendingDelivery();

    await expect(
      sendDailyDigest({
        db: db as never,
        digestId: 'digest-1',
        to: 'tim@example.test',
        digestUrl: 'https://timeline.test/app',
        fetch: fetchMock,
        now: new Date('2026-06-14T12:05:00Z'),
      }),
    ).resolves.toEqual({
      ok: false,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'pending',
      error: 'Delivery is already pending.',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({ status: 'generated', deliveryId: 'delivery-1' }),
    );
    expect(updates).not.toContainEqual(expect.objectContaining({ status: 'sent' }));
  });

  it('skips digest delivery when the recipient is no longer an active member', async () => {
    const updates: unknown[] = [];
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: 'digest-1',
                    teamId: 'team-1',
                    userId: 'user-1',
                    payload: {
                      teamName: 'Timeline',
                      userName: null,
                      windowStart: '2026-06-13T12:00:00.000Z',
                      windowEnd: '2026-06-14T12:00:00.000Z',
                      summary: 'Summary',
                      pendingApprovals: 0,
                      eventCount: 0,
                      sourceDistribution: {},
                      objectChangesByType: {},
                      newTeamMembers: [],
                      tasks: [],
                      upcomingCalendar: [],
                      links: [],
                    },
                  },
                ]),
              })),
            })),
          };
        }
        const chain = {
          innerJoin: vi.fn(() => chain),
          leftJoin: vi.fn(() => chain),
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        };
        return { from: vi.fn(() => chain) };
      }),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };

    await expect(
      sendDailyDigest({
        db: db as never,
        digestId: 'digest-1',
        to: 'old@example.test',
        digestUrl: 'https://timeline.test/app',
      }),
    ).resolves.toMatchObject({ ok: true, skipped: true, skippedStatus: 'skipped' });

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: 'skipped',
        error: 'Recipient is no longer a team member.',
      }),
    );
  });

  it('skips email when the digest window has already rolled to the next cycle', async () => {
    process.env.RESEND_API_KEY = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn();
    const updates: unknown[] = [];
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 2) {
          const chain = {
            innerJoin: vi.fn(() => chain),
            leftJoin: vi.fn(() => chain),
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  email: 'tim@example.test',
                  removedAt: null,
                  dailyDigestEnabled: true,
                },
              ]),
            })),
          };
          return { from: vi.fn(() => chain) };
        }
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue(
                selectCount === 1
                  ? [
                      {
                        id: 'digest-1',
                        teamId: 'team-1',
                        userId: 'user-1',
                        windowEnd: new Date('2026-06-14T12:00:00.000Z'),
                        payload: {},
                      },
                    ]
                  : [{ dailyDigestEnabled: true, dailyDigestHour: 12, timezone: 'UTC' }],
              ),
            })),
          })),
        };
      }),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updates.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };

    await expect(
      sendDailyDigest({
        db: db as never,
        digestId: 'digest-1',
        to: 'tim@example.test',
        digestUrl: 'https://timeline.test/app',
        fetch: fetchMock,
        now: new Date('2026-06-15T13:00:00Z'),
      }),
    ).resolves.toMatchObject({ ok: true, skipped: true, skippedStatus: 'skipped' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: 'skipped',
        error: 'Digest window expired before send.',
      }),
    );
  });
});

describe('workspace email metering', () => {
  it('exempts verification mail, billing alerts, and support requests', () => {
    expect(shouldMeterWorkspaceEmail('email_verification', { db: {}, teamId: 'team-1' })).toBe(
      false,
    );
    expect(shouldMeterWorkspaceEmail('billing_usage_alert', { db: {}, teamId: 'team-1' })).toBe(
      false,
    );
    expect(shouldMeterWorkspaceEmail('support_request', { db: {}, teamId: 'team-1' })).toBe(false);
    expect(shouldMeterWorkspaceEmail('welcome', { db: {}, teamId: 'team-1' })).toBe(true);
    expect(shouldMeterWorkspaceEmail('email_verification', { db: {}, teamId: null })).toBe(false);
  });
});
