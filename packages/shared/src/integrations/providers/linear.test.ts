import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationEvent, SyncContext } from '#src/integrations/types.js';

import { resetEnvForTests } from '#src/env.js';
import { linearProvider, verifyLinearSignature } from '#src/integrations/providers/linear.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function requestPayload(init: RequestInit | undefined): {
  query: string;
  variables: Record<string, unknown>;
} {
  if (typeof init?.body !== 'string') throw new Error('expected GraphQL JSON body');
  const parsed = JSON.parse(init.body) as { query?: unknown; variables?: unknown };
  return {
    query: typeof parsed.query === 'string' ? parsed.query : '',
    variables:
      typeof parsed.variables === 'object' && parsed.variables !== null
        ? (parsed.variables as Record<string, unknown>)
        : {},
  };
}

function issue(id: number, updatedAt: string) {
  return {
    id: `issue-${String(id)}`,
    identifier: `ENG-${String(id)}`,
    title: `Issue ${String(id)}`,
    description: null,
    url: `https://linear.app/acme/issue/ENG-${String(id)}`,
    updatedAt,
    priority: 3,
    priorityLabel: 'Medium',
    state: { id: 'state-started', name: 'In Progress', type: 'started' },
    assignee: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
    team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
    project: { id: 'project-1', name: 'Launch' },
    parent: null,
  };
}

function comment(id: number, updatedAt: string) {
  return {
    id: `comment-${String(id)}`,
    body: `Comment ${String(id)}`,
    url: `https://linear.app/acme/issue/ENG-1#comment-${String(id)}`,
    updatedAt,
    user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
    issue: { id: 'issue-1', identifier: 'ENG-1', title: 'Issue 1' },
  };
}

function project(id: number, updatedAt: string) {
  return {
    id: `project-${String(id)}`,
    name: `Project ${String(id)}`,
    description: null,
    url: `https://linear.app/acme/project/${String(id)}`,
    updatedAt,
    state: 'started',
    targetDate: null,
    startDate: null,
    lead: { id: 'user-1', name: 'Ada' },
  };
}

function expectFirst<T>(arr: T[]): T {
  const first = arr[0];
  if (!first) throw new Error('expected at least one element');
  return first;
}

function webhookEvents(
  result: Awaited<ReturnType<NonNullable<typeof linearProvider.handleWebhook>>>,
) {
  return Array.isArray(result) ? result : result.events;
}

describe('linearProvider.handleWebhook', () => {
  it('normalizes an Issue webhook', async () => {
    const handle = linearProvider.handleWebhook?.bind(linearProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = webhookEvents(
      await handle({
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
      }),
    );
    expect(events).toHaveLength(1);
    const evt = expectFirst(events);
    expect(evt.dedupKey).toBe('linear:issue:LIN-1:2026-05-25T10:00:00Z');
    expect(evt.eventType).toBe('issue.updated');
    expect(evt.actor?.name).toBe('Alice');
    expect(evt.objectMap).toMatchObject({
      canonicalName: 'ENG-42: Wire Phase 11',
      displayTitle: 'Wire Phase 11',
      externalId: 'LIN-1',
      aliases: ['ENG-42'],
      metadata: {
        linear_record_kind: 'issue',
        linear_identifier: 'ENG-42',
        linear_team_id: 't1',
        linear_team_key: 'ENG',
      },
    });
  });

  it('ignores non-Issue payloads', async () => {
    const handle = linearProvider.handleWebhook?.bind(linearProvider);
    if (!handle) throw new Error('no handleWebhook');
    const events = webhookEvents(
      await handle({
        integration: { teamId: 't1' } as never,
        payload: { action: 'create', type: 'Comment', data: { id: 'x' } },
      }),
    );
    expect(events).toHaveLength(0);
  });
});

describe('linearProvider.listSyncableResources', () => {
  it('paginates Linear teams so source selection can see teams beyond page one', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      expect(body.query).toContain('teams(first: 100');
      if (body.variables.after === null) {
        return Promise.resolve(
          jsonResponse({
            data: {
              teams: {
                nodes: [{ id: 'team-1', name: 'Engineering', key: 'ENG' }],
                pageInfo: { hasNextPage: true, endCursor: 'team-page-2' },
              },
            },
          }),
        );
      }
      if (body.variables.after === 'team-page-2') {
        return Promise.resolve(
          jsonResponse({
            data: {
              teams: {
                nodes: [{ id: 'team-2', name: 'Support', key: 'SUP' }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ errors: [{ message: 'unexpected team page' }] }));
    });
    vi.stubGlobal('fetch', fetch);

    const resources = await linearProvider.listSyncableResources({ id: 'integration-1' } as never, {
      access_token: 'linear-token',
    });

    expect(resources).toEqual([
      { externalId: 'team-1', label: 'Engineering (ENG)', kind: 'linear.team' },
      { externalId: 'team-2', label: 'Support (SUP)', kind: 'linear.team' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('linearProvider.incrementalSync', () => {
  it('paginates Linear issues, comments, and projects before advancing cursors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      expect(body.variables.teamIds).toEqual(['team-1']);
      expect(body.variables.since).toBe('2026-06-20T00:00:00.000Z');

      if (body.query.includes('issues(first: 50')) {
        if (body.variables.after === null) {
          return Promise.resolve(
            jsonResponse({
              data: {
                issues: {
                  nodes: [issue(1, '2026-06-20T10:00:00.000Z')],
                  pageInfo: { hasNextPage: true, endCursor: 'issue-page-2' },
                },
              },
            }),
          );
        }
        if (body.variables.after === 'issue-page-2') {
          return Promise.resolve(
            jsonResponse({
              data: {
                issues: {
                  nodes: [issue(2, '2026-06-20T11:00:00.000Z')],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            }),
          );
        }
      }

      if (body.query.includes('comments(first: 50')) {
        if (body.variables.after === null) {
          return Promise.resolve(
            jsonResponse({
              data: {
                comments: {
                  nodes: [comment(1, '2026-06-20T12:00:00.000Z')],
                  pageInfo: { hasNextPage: true, endCursor: 'comment-page-2' },
                },
              },
            }),
          );
        }
        if (body.variables.after === 'comment-page-2') {
          return Promise.resolve(
            jsonResponse({
              data: {
                comments: {
                  nodes: [comment(2, '2026-06-20T13:00:00.000Z')],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            }),
          );
        }
      }

      if (body.query.includes('projects(first: 50')) {
        if (body.variables.after === null) {
          return Promise.resolve(
            jsonResponse({
              data: {
                projects: {
                  nodes: [project(1, '2026-06-20T14:00:00.000Z')],
                  pageInfo: { hasNextPage: true, endCursor: 'project-page-2' },
                },
              },
            }),
          );
        }
        if (body.variables.after === 'project-page-2') {
          return Promise.resolve(
            jsonResponse({
              data: {
                projects: {
                  nodes: [project(2, '2026-06-20T15:00:00.000Z')],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            }),
          );
        }
      }

      return Promise.resolve(jsonResponse({ errors: [{ message: 'unexpected sync page' }] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn<SyncContext['loadCursor']>().mockResolvedValue({
        updated_after: '2026-06-20T00:00:00.000Z',
      }),
      saveCursor: vi.fn<SyncContext['saveCursor']>().mockResolvedValue(undefined),
      writeEvents: vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]),
      persistTokens: vi.fn<SyncContext['persistTokens']>().mockResolvedValue(undefined),
      recordAudit: vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined),
    };

    await linearProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'linear-token', expires_at: Date.now() + 48 * 60 * 60 * 1000 },
      selections: [{ kind: 'linear.team', externalId: 'team-1' }],
      ctx,
    });

    const requests = fetch.mock.calls.map(([, init]) => requestPayload(init));
    expect(
      requests
        .filter((request) => request.query.includes('issues(first: 50'))
        .map((request) => request.variables.after),
    ).toEqual([null, 'issue-page-2']);
    expect(
      requests
        .filter((request) => request.query.includes('comments(first: 50'))
        .map((request) => request.variables.after),
    ).toEqual([null, 'comment-page-2']);
    expect(
      requests
        .filter((request) => request.query.includes('projects(first: 50'))
        .map((request) => request.variables.after),
    ).toEqual([null, 'project-page-2']);

    const events: IntegrationEvent[] = ctx.writeEvents.mock.calls.flatMap(([batch]) => batch);
    expect(events.map((event) => event.externalObjectId)).toEqual([
      'issue-1',
      'issue-2',
      'issue-1#comment:comment-1',
      'issue-1#comment:comment-2',
      'project-1',
      'project-2',
    ]);
    expect(events.find((event) => event.externalObjectId === 'project-1')?.objectMap).toMatchObject(
      {
        type: 'project',
        metadata: {
          linear_record_kind: 'project',
          linear_state: 'started',
        },
      },
    );
    expect(ctx.saveCursor).toHaveBeenCalledWith('linear.issues', {
      updated_after: '2026-06-20T11:00:00.000Z',
    });
    expect(ctx.saveCursor).toHaveBeenCalledWith('linear.comments', {
      updated_after: '2026-06-20T13:00:00.000Z',
    });
    expect(ctx.saveCursor).toHaveBeenCalledWith('linear.projects', {
      updated_after: '2026-06-20T15:00:00.000Z',
    });
    expect(Math.max(...ctx.writeEvents.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...ctx.saveCursor.mock.invocationCallOrder),
    );
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
