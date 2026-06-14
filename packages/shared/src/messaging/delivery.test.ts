import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { messagingInternals, sendDailyDigest, sendMessage } from '#src/messaging/delivery.js';
import { renderMessage } from '#src/messaging/templates.js';

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
            limit: vi
              .fn()
              .mockResolvedValue(existing ? [{ id: existing.id, status: existing.status }] : []),
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
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue(
                selectCount === 1
                  ? [
                      {
                        id: 'digest-1',
                        teamId: 'team-1',
                        userId: 'user-1',
                        payload,
                      },
                    ]
                  : [{ id: 'delivery-1', status: 'pending' }],
              ),
            })),
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

describe('Postmark messaging adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...OLD_ENV };
    resetEnvForTests();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    resetEnvForTests();
    vi.restoreAllMocks();
  });

  it('fails visibly when outbound email is not configured', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.TRANSACTIONAL_EMAIL_FROM;

    const message = renderMessage('welcome', {
      to: 'tim@example.test',
      name: 'Tim',
      teamName: 'Timeline',
      dashboardUrl: 'https://timeline.test/app',
    });

    await expect(messagingInternals.sendPostmarkEmail(message)).resolves.toEqual({
      ok: false,
      error: 'Outbound email is not configured',
    });
  });

  it('returns the provider message id on success', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ MessageID: 'postmark-id' }), {
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

    await expect(messagingInternals.sendPostmarkEmail(message, fetchMock)).resolves.toEqual({
      ok: true,
      providerMessageId: 'postmark-id',
    });
  });

  it('maps provider errors into short delivery errors', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ Message: 'Bad recipient' }), {
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

    await expect(messagingInternals.sendPostmarkEmail(message, fetchMock)).resolves.toEqual({
      ok: false,
      error: 'Bad recipient',
    });
  });

  it('retries a failed deduped delivery instead of skipping Postmark', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ MessageID: 'retry-id' }), {
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
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
    expect(updates).toContainEqual(
      expect.objectContaining({ status: 'sent', providerMessageId: 'retry-id' }),
    );
  });

  it('does not send when a deduped delivery is already pending', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
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
      ok: true,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'pending',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
  });

  it('retries a stale pending deduped delivery', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <hello@example.test>';
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ MessageID: 'pending-retry-id' }), {
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
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
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
      ok: true,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'pending',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
  });

  it('skips Postmark only when the deduped delivery is already sent', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
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

  it('does not mark a digest sent when its delivery is skipped because another send is pending', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
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
      }),
    ).resolves.toEqual({
      ok: true,
      deliveryId: 'delivery-1',
      skipped: true,
      skippedStatus: 'pending',
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
});
