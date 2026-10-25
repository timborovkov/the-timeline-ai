import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { forwardSentryTunnelEnvelope, sentryIngestTargetFromDsn } from '@/lib/sentry-tunnel';

const DSN = 'https://publickey@o123.ingest.sentry.io/450999';

function onCloseOnce(res: EventEmitter, listener: () => void): () => void {
  const bound = (res as EventEmitter & { __timelineClose?: () => void }).__timelineClose;
  if (bound) {
    res.off('close', bound);
  }
  const wrapped = () => {
    listener();
    res.off('close', wrapped);
  };
  (res as EventEmitter & { __timelineClose?: () => void }).__timelineClose = wrapped;
  res.on('close', wrapped);
  return () => {
    res.off('close', wrapped);
    delete (res as EventEmitter & { __timelineClose?: () => void }).__timelineClose;
  };
}

describe('sentry tunnel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the ingest URL from the configured DSN and rejects non-https', () => {
    expect(sentryIngestTargetFromDsn(DSN)).toEqual({
      host: 'o123.ingest.sentry.io',
      projectId: '450999',
      url: 'https://o123.ingest.sentry.io/api/450999/envelope/?sentry_key=publickey&sentry_version=7',
    });
    expect(sentryIngestTargetFromDsn('http://publickey@localhost/1')).toBeNull();
    expect(sentryIngestTargetFromDsn(undefined)).toBeNull();
  });

  it('rejects an oversized envelope without Content-Length while streaming', async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 8) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const response = await forwardSentryTunnelEnvelope({
      dsn: DSN,
      req: new Request('https://timeline.test/sentry-tunnel', {
        method: 'POST',
        body: stream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
      fetchImpl,
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ reason: 'payload_too_large' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it('forwards the envelope only to the configured ingest host', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe(
        'https://o123.ingest.sentry.io/api/450999/envelope/?sentry_key=publickey&sentry_version=7',
      );
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { 'x-sentry-rate-limits': '60:transaction:key' },
        }),
      );
    });
    const response = await forwardSentryTunnelEnvelope({
      dsn: DSN,
      req: new Request('https://timeline.test/sentry-tunnel', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: '{"dsn":"https://evil@attacker.example/1"}\n{}',
      }),
      fetchImpl,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-sentry-rate-limits')).toBe('60:transaction:key');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('forwards with fetch and does not register Node ServerResponse close listeners', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/sentry-tunnel.ts'), 'utf8');
    expect(source).toContain('fetchImpl');
    expect(source).not.toMatch(/\bon\(\s*['"]close['"]/);
    expect(source).not.toMatch(/node:http/);
  });

  it('keeps close listeners bounded when register-once cleanup is used', () => {
    const res = new EventEmitter();
    const cleanups: (() => void)[] = [];
    for (let i = 0; i < 20; i += 1) {
      cleanups.push(onCloseOnce(res, () => undefined));
    }
    expect(res.listenerCount('close')).toBe(1);
    for (const cleanup of cleanups) cleanup();
    expect(res.listenerCount('close')).toBe(0);
  });

  it('does not configure Next tunnelRoute rewrites', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(config).not.toMatch(/tunnelRoute\s*:/);
    const client = readFileSync(join(process.cwd(), 'src/instrumentation-client.ts'), 'utf8');
    expect(client).toContain("tunnel: '/sentry-tunnel'");
  });
});
