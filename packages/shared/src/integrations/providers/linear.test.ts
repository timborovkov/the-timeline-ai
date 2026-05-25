import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '../../env.js';

import { linearProvider, verifyLinearSignature } from './linear.js';

function expectFirst<T>(arr: T[]): T {
  const first = arr[0];
  if (!first) throw new Error('expected at least one element');
  return first;
}

describe('linearProvider.handleWebhook', () => {
  it('normalizes an Issue webhook', async () => {
    const handle = linearProvider.handleWebhook?.bind(linearProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = await handle({
      integration: { teamId: 't1' } as never,
      payload: {
        action: 'update',
        type: 'Issue',
        data: {
          id: 'LIN-1',
          identifier: 'ENG-42',
          title: 'Wire Phase 11',
          description: null,
          url: 'https://linear.app/acme/issue/ENG-42',
          updatedAt: '2026-05-25T10:00:00Z',
          state: { name: 'In Progress', type: 'started' },
          assignee: { id: 'u1', name: 'Alice', email: null },
          team: { id: 't1', key: 'ENG' },
        },
      },
    });
    expect(events).toHaveLength(1);
    const evt = expectFirst(events);
    expect(evt.dedupKey).toBe('linear:issue:LIN-1:2026-05-25T10:00:00Z');
    expect(evt.eventType).toBe('issue.updated');
    expect(evt.actor?.name).toBe('Alice');
  });

  it('ignores non-Issue payloads', async () => {
    const handle = linearProvider.handleWebhook?.bind(linearProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = await handle({
      integration: { teamId: 't1' } as never,
      payload: { action: 'create', type: 'Comment', data: { id: 'x' } },
    });
    expect(events).toHaveLength(0);
  });
});

describe('verifyLinearSignature', () => {
  const original = process.env.LINEAR_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.LINEAR_WEBHOOK_SECRET = 'whsec';
    resetEnvForTests();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.LINEAR_WEBHOOK_SECRET;
    else process.env.LINEAR_WEBHOOK_SECRET = original;
    resetEnvForTests();
  });

  it('verifies a valid signature', () => {
    const body = '{"a":1}';
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
    expect(verifyLinearSignature(body, sig)).toBe(true);
  });

  it('rejects a bad signature', () => {
    expect(verifyLinearSignature('{}', 'deadbeef')).toBe(false);
  });
});
