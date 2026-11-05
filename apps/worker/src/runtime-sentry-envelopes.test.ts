import * as Sentry from '@sentry/node';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

const ALLOWED_ITEM_TYPES = new Set(['event', 'session', 'client_report']);

function envelopeItems(envelope: unknown): { type: string; payload: unknown }[] {
  if (!Array.isArray(envelope) || envelope.length < 2) return [];
  const items: unknown = envelope[1];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!Array.isArray(item) || item.length === 0) return [];
    const header: unknown = item[0];
    const payload: unknown = item[1];
    if (header === null || typeof header !== 'object') {
      return [{ type: 'unknown', payload }];
    }
    const type = 'type' in header && typeof header.type === 'string' ? header.type : 'unknown';
    return [{ type, payload }];
  });
}

function eventExceptionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('exception' in payload)) return '';
  const exception: unknown = payload.exception;
  if (!exception || typeof exception !== 'object' || !('values' in exception)) return '';
  const values: unknown = exception.values;
  if (!Array.isArray(values)) return '';
  return (values as unknown[])
    .flatMap((value) => {
      if (!value || typeof value !== 'object' || !('value' in value)) return [];
      const message: unknown = 'value' in value ? value.value : undefined;
      return typeof message === 'string' ? [message] : [];
    })
    .join('\n');
}

describe('Sentry Bun runtime envelopes', () => {
  afterEach(async () => {
    await Sentry.close(5_000);
    delete process.env.GITHUB_SHA;
  });

  it('captures one error event and a release-health session when GITHUB_SHA is set', async () => {
    process.env.GITHUB_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const items: { type: string; payload: unknown }[] = [];
    Sentry.init({
      dsn: 'https://public@example.invalid/1',
      transport: () => ({
        send: (envelope) => {
          items.push(...envelopeItems(envelope));
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });

    Sentry.captureException(new Error('synthetic Bun runtime smoke'));
    await expect(Sentry.flush(5_000)).resolves.toBe(true);

    const types = items.map((item) => item.type);
    const events = items.filter((item) => item.type === 'event');
    expect(events).toHaveLength(1);
    expect(types.some((type) => type === 'session')).toBe(true);
    expect(types.every((type) => ALLOWED_ITEM_TYPES.has(type))).toBe(true);
    expect(eventExceptionText(events[0]?.payload)).toContain('synthetic Bun runtime smoke');
  });
});
