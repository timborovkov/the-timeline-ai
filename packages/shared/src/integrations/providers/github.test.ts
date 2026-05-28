import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { githubProvider, verifyGithubSignature } from '#src/integrations/providers/github.js';

function expectFirst<T>(arr: T[]): T {
  const first = arr[0];
  if (!first) throw new Error('expected at least one element');
  return first;
}

describe('githubProvider.handleWebhook', () => {
  it('normalizes a PR webhook to an IntegrationEvent', async () => {
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = await handle({
      integration: { teamId: 't1' } as never,
      payload: {
        action: 'opened',
        pull_request: {
          id: 42,
          number: 7,
          title: 'Add Phase 11',
          body: 'Description',
          html_url: 'https://github.com/acme/repo/pull/7',
          state: 'open',
          merged_at: null,
          updated_at: '2026-05-25T10:00:00Z',
          user: { login: 'alice' },
          base: { ref: 'main' },
          head: { ref: 'phase-11' },
        },
        repository: { full_name: 'acme/repo' },
      },
    });
    expect(events).toHaveLength(1);
    const evt = expectFirst(events);
    expect(evt.provider).toBe('github');
    expect(evt.eventType).toBe('pr.updated');
    expect(evt.externalObjectId).toBe('acme/repo#7');
    expect(evt.dedupKey).toBe('github:pr:42:2026-05-25T10:00:00Z');
  });

  it('emits pr.merged when merged_at is set', async () => {
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = await handle({
      integration: { teamId: 't1' } as never,
      payload: {
        action: 'closed',
        pull_request: {
          id: 42,
          number: 7,
          title: 't',
          body: null,
          html_url: 'x',
          state: 'closed',
          merged_at: '2026-05-26T10:00:00Z',
          updated_at: '2026-05-26T10:00:00Z',
          user: null,
          base: { ref: 'main' },
          head: { ref: 'b' },
        },
        repository: { full_name: 'acme/repo' },
      },
    });
    expect(expectFirst(events).eventType).toBe('pr.merged');
  });

  it('skips issues that are actually PRs', async () => {
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = await handle({
      integration: { teamId: 't1' } as never,
      payload: {
        action: 'opened',
        issue: {
          id: 1,
          number: 1,
          title: 'has-pr',
          body: null,
          html_url: 'x',
          state: 'open',
          updated_at: '2026-05-25T00:00:00Z',
          user: null,
          pull_request: { html_url: 'x' },
        },
        repository: { full_name: 'acme/repo' },
      },
    });
    expect(events).toHaveLength(0);
  });

  it('ignores payloads with no repo', async () => {
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = await handle({
      integration: { teamId: 't1' } as never,
      payload: {},
    });
    expect(events).toHaveLength(0);
  });
});

describe('verifyGithubSignature', () => {
  const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = 'whsec';
    resetEnvForTests();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    resetEnvForTests();
  });

  it('verifies a valid signature', () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac('sha256', 'whsec').update(body).digest('hex')}`;
    expect(verifyGithubSignature(body, sig)).toBe(true);
  });

  it('rejects a bad signature', () => {
    expect(verifyGithubSignature('{"a":1}', 'sha256=bad')).toBe(false);
  });

  it('rejects when secret is missing', () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    resetEnvForTests();
    expect(verifyGithubSignature('{}', 'sha256=anything')).toBe(false);
  });
});
