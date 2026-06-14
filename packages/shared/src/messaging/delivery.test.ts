import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { messagingInternals, sendMessage } from '#src/messaging/delivery.js';
import { renderMessage } from '#src/messaging/templates.js';

function fakeDeliveryDb(existing: { id: string; status: string; dedupeKey: string } | null) {
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
          return { where: vi.fn().mockResolvedValue(undefined) };
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
    ).resolves.toEqual({ ok: true, deliveryId: 'delivery-1', skipped: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});
