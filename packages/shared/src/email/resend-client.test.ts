/* eslint-disable @typescript-eslint/require-await -- Injectable HTTP mocks resolve synthetic responses. */
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import {
  resendRequest,
  retrieveInboundEmail,
  ResendError,
  retryAfterMilliseconds,
  type EmailFetch,
} from '#src/email/resend-client.js';
import { resetEnvForTests } from '#src/env.js';

const backup = { ...process.env };
const id = '11111111-1111-4111-8111-111111111111';
const received = {
  id,
  from: 'Ada <ada@example.test>',
  to: ['team@inbound.test'],
  cc: ['other@inbound.test'],
  bcc: [],
  received_for: ['forward@inbound.test'],
  subject: 'Hello',
  text: 'Reply',
  html: '<p>Reply</p>',
  created_at: '2026-11-01T10:00:00Z',
  message_id: '<source@example.test>',
  headers: {
    'In-Reply-To': '<parent@example.test>',
    'Authentication-Results': 'attacker; spf=pass',
  },
  authentication: { spf: 'fail', dkim: 'pass', dmarc: 'pass' },
};
const attachment = {
  id: 'a1',
  filename: 'note.txt',
  content_type: 'text/plain',
  size: 4,
  content_id: 'inline1',
  download_url: 'https://inbound-cdn.resend.com/file?signature=private',
};
beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test';
  resetEnvForTests();
});
afterEach(() => {
  process.env = { ...backup };
  resetEnvForTests();
});
describe('Resend receiving transport', () => {
  it('hydrates normalized bodies, routing, RFC headers and paginated attachment bytes', async () => {
    const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = url instanceof Request ? url.url : url.toString();
      if (value.includes('inbound-cdn')) {
        expect(init?.redirect).toBe('error');
        expect(init?.headers).toBeUndefined();
        return new Response('data');
      }
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer re_test' });
      if (value.includes('after=a1'))
        return Response.json({ data: [{ ...attachment, id: 'a2' }], has_more: false });
      if (value.includes('/attachments'))
        return Response.json({ data: [attachment], has_more: true });
      return Response.json(received);
    });
    const email = await retrieveInboundEmail(id, mock);
    expect(email).toMatchObject({
      providerId: id,
      fromAddress: { email: 'ada@example.test', name: 'Ada' },
      receivedFor: ['forward@inbound.test'],
      authentication: { spf: 'fail', dkim: 'pass' },
    });
    expect(email.headers).toContainEqual({ name: 'Message-ID', value: '<source@example.test>' });
    expect(email.attachments).toHaveLength(2);
    expect(email.attachments[0]?.content.toString()).toBe('data');
    expect(JSON.stringify(email)).not.toContain('signature=');
  });
  it('enforces the cumulative cap even when content length is absent or understated', async () => {
    const mock: EmailFetch = async (url) => {
      if ((url instanceof Request ? url.url : url.toString()).includes('inbound-cdn'))
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(25 * 1024 * 1024));
              controller.enqueue(new Uint8Array(1));
              controller.close();
            },
          }),
        );
      if ((url instanceof Request ? url.url : url.toString()).includes('/attachments'))
        return Response.json({ data: [attachment], has_more: false });
      return Response.json(received);
    };
    const email = await retrieveInboundEmail(id, mock);
    expect(email.attachments).toHaveLength(0);
    expect(email.attachmentsDropped).toEqual([
      { filename: 'note.txt', reason: 'total_size_cap_exceeded' },
    ]);
  });
  it('fetches fresh URLs on retry after an expired download fails', async () => {
    let pass = 0;
    const mock: EmailFetch = async (url) => {
      if ((url instanceof Request ? url.url : url.toString()).includes('inbound-cdn'))
        return pass === 1 ? new Response('', { status: 403 }) : new Response('data');
      if ((url instanceof Request ? url.url : url.toString()).includes('/attachments')) {
        pass++;
        return Response.json({
          data: [{ ...attachment, download_url: `${attachment.download_url}&pass=${pass}` }],
        });
      }
      return Response.json(received);
    };
    await expect(retrieveInboundEmail(id, mock)).rejects.toMatchObject({ retryable: true });
    expect((await retrieveInboundEmail(id, mock)).attachments).toHaveLength(1);
    expect(pass).toBe(2);
  });
  it('rejects unsafe URLs and never follows redirects', async () => {
    const mock: EmailFetch = async (url) =>
      (url instanceof Request ? url.url : url.toString()).includes('/attachments')
        ? Response.json({
            data: [{ ...attachment, download_url: 'http://169.254.169.254/latest/meta-data' }],
          })
        : Response.json(received);
    await expect(retrieveInboundEmail(id, mock)).rejects.toMatchObject({
      code: 'unsafe_attachment_url',
      retryable: false,
    });
  });
  it('classifies provider errors without leaking bodies and honours Retry-After', async () => {
    for (const [status, retryable] of [
      [422, false],
      [401, false],
      [429, true],
      [503, true],
    ] as const) {
      await expect(
        resendRequest('/emails', {}, async () =>
          Response.json(
            { name: 'provider_error', message: 'private email content' },
            { status, headers: { 'retry-after': '120' } },
          ),
        ),
      ).rejects.toMatchObject({
        retryable,
        retryAfterMs: 120_000,
        message: 'Resend request failed: provider_error',
      });
    }
    expect(retryAfterMilliseconds('invalid')).toBe(0);
    expect(new ResendError('network_error', true).retryable).toBe(true);
  });
});
