import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { PGlite as PGliteType } from '@electric-sql/pglite';
type PGlite = PGliteType;

await vi.mock(
  import.meta.resolve('#src/queue/queues.js'),
  async () => ({
    ...(await import('#src/queue/queues.js')),
    enqueueExtractJob: vi.fn().mockResolvedValue(undefined),
    enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-job' }),
    enqueueSuggestionJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'proposal-job' }),
  }),
  () => import('#src/queue/queues.js'),
);

const { PGlite } = await import('@electric-sql/pglite');
const {
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  entities,
  integrations,
  rawEvents,
} = await import('@timeline/db');
const { eq } = await import('drizzle-orm');
const { drizzle } = await import('drizzle-orm/pglite');
const { withTeam } = await import('#src/team-scope.js');
const { writeIntegrationEvents } = await import('#src/integrations/event-writer.js');
const {
  capturedWorkItemFromIntegrationEvent,
  compactGithubPersonKey,
  githubLoginFromConnectionDisplayName,
  githubWorkItemFromIntegrationEvent,
  githubWorkItemFromRawMetadata,
  matchOpenTasksToCapturedWorkItem,
  matchOpenTasksToGithubWorkItem,
  planGithubTaskProposal,
  proposeGithubTaskUpdatesForTeam,
  proposeGithubTaskUpdatesFromRawEvent,
  resolveGithubLoginToUserId,
} = await import('#src/integrations/github-task-proposals.js');
const { GITHUB_TASK_PROPOSAL_COALESCE_MS } = await import('#src/integrations/ingest-processing.js');
const { enqueueSuggestionJob } = await import('#src/queue/queues.js');
const { applyDbMigrations } = await import('#src/test/pglite.js');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function githubPrWorkItem(overrides: Record<string, unknown> = {}) {
  return githubWorkItemFromIntegrationEvent({
    dedupKey: 'github:pr:10:merged',
    provider: 'github',
    externalObjectId: 'timborovkov/audit-ai#10',
    eventType: 'pr.merged',
    occurredAt: new Date('2026-06-01T12:00:00Z'),
    actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
    contentText:
      'GitHub PR timborovkov/audit-ai#10 — Fix theme system detection broken until page reload',
    extra: {
      github: {
        type: 'pull_request',
        repo: 'timborovkov/audit-ai',
        number: 10,
        merged_at: '2026-06-01T12:00:00Z',
        state: 'closed',
        assignees: [],
      },
    },
    objectMap: {
      type: 'task',
      canonicalName: 'timborovkov/audit-ai#10: Fix theme system detection broken until page reload',
      displayTitle: 'audit-ai: Fix theme system detection broken until page reload',
      externalId: 'timborovkov/audit-ai#10',
      status: 'done',
      aliases: ['PR-timborovkov/audit-ai-10'],
    },
    ...overrides,
  });
}

describe('GitHub task proposal matching', () => {
  it('parses GitHub connection display names into logins', () => {
    expect(githubLoginFromConnectionDisplayName('GitHub — taylorbennett')).toBe('taylorbennett');
    expect(githubLoginFromConnectionDisplayName('GitHub - octocat')).toBe('octocat');
    expect(githubLoginFromConnectionDisplayName('GitHub')).toBeNull();
  });

  it('maps GitHub logins through connection ownership before name compaction', () => {
    const members = [
      { userId: USER_ID, name: 'Taylor Bennett' },
      { userId: OTHER_USER_ID, name: 'Other Person' },
    ];
    expect(
      resolveGithubLoginToUserId('taylorbennett', members, new Map([[USER_ID, ['taylorbennett']]])),
    ).toBe(USER_ID);
    expect(resolveGithubLoginToUserId('taylorbennett', members, new Map())).toBe(USER_ID);
    expect(compactGithubPersonKey('Taylor Bennett')).toBe('taylorbennett');
    expect(
      resolveGithubLoginToUserId(
        'octocat',
        [{ userId: USER_ID, name: 'Other Person', email: 'octocat@example.com' }],
        new Map(),
      ),
    ).toBe(USER_ID);
    expect(resolveGithubLoginToUserId('octocat', members, new Map())).toBeNull();
  });

  it('does not treat the GitHub connector as the assignee unless the actor login maps', () => {
    const workItem = githubPrWorkItem({
      actor: { externalId: 'someone-else', name: 'someone-else' },
    });
    expect(workItem?.actorLogin).toBe('someone-else');
    expect(
      resolveGithubLoginToUserId(
        workItem?.actorLogin ?? '',
        [{ userId: USER_ID, name: 'Taylor Bennett' }],
        new Map([[USER_ID, ['taylorbennett']]]),
      ),
    ).toBeNull();
  });

  it('matches Timeline tasks by provider id, alias, or repo plus PR number', () => {
    const workItem = githubPrWorkItem();
    if (!workItem) throw new Error('expected work item');
    const providerTask = {
      id: '11111111-1111-4111-8111-111111111111',
      canonicalName: 'Unrelated local title',
      aliases: [],
      metadata: {
        integration_provider: 'github',
        integration_external_id: 'timborovkov/audit-ai#10',
      },
      status: 'todo',
      ownerUserId: null,
      assigneeUserId: null,
    };
    const titleTask = {
      id: '22222222-2222-4222-8222-222222222222',
      canonicalName: 'Fix theme system detection broken until page reload in audit-ai PR #10',
      aliases: [],
      metadata: {},
      status: 'todo',
      ownerUserId: USER_ID,
      assigneeUserId: null,
    };
    expect(matchOpenTasksToGithubWorkItem(workItem, [providerTask, titleTask])).toEqual([
      { task: providerTask, match: 'provider_id' },
    ]);
    expect(matchOpenTasksToGithubWorkItem(workItem, [titleTask])).toEqual([
      { task: titleTask, match: 'title' },
    ]);
  });

  it('does not treat repository-local PR numbers as globally unique aliases', () => {
    const work = githubPrWorkItem();
    if (!work) throw new Error('missing work item');
    expect(
      matchOpenTasksToGithubWorkItem(work, [
        {
          id: USER_ID,
          canonicalName: 'Unrelated change',
          aliases: ['example/another-repo#10', 'PR #10'],
          metadata: {},
          status: 'done',
          ownerUserId: null,
          assigneeUserId: null,
        },
      ]),
    ).toEqual([]);
  });

  it('does not fuzzy-match when multiple title candidates exist', () => {
    const workItem = githubPrWorkItem();
    if (!workItem) throw new Error('expected work item');
    const first = {
      id: '33333333-3333-4333-8333-333333333333',
      canonicalName: 'Fix theme system detection broken until page reload in audit-ai PR #10',
      aliases: [],
      metadata: {},
      status: 'todo',
      ownerUserId: null,
      assigneeUserId: null,
    };
    const second = {
      id: '44444444-4444-4444-8444-444444444444',
      canonicalName: 'Fix theme system detection broken until page reload audit-ai#10 follow-up',
      aliases: [],
      metadata: {},
      status: 'todo',
      ownerUserId: null,
      assigneeUserId: null,
    };
    expect(matchOpenTasksToGithubWorkItem(workItem, [first, second])).toEqual([]);
  });

  it('proposes done for merged PRs and assignee only when the task is unassigned', () => {
    const workItem = githubPrWorkItem();
    if (!workItem) throw new Error('expected work item');
    const task = {
      id: '55555555-5555-4555-8555-555555555555',
      canonicalName: 'Fix theme system detection broken until page reload in audit-ai PR #10',
      aliases: [],
      metadata: {},
      status: 'todo',
      ownerUserId: USER_ID,
      assigneeUserId: null,
    };
    expect(
      planGithubTaskProposal({
        workItem,
        task,
        match: 'title',
        assigneeUserId: USER_ID,
      }),
    ).toMatchObject({
      status: 'done',
      assigneeUserId: USER_ID,
      ownerUserId: null,
    });
    expect(
      planGithubTaskProposal({
        workItem,
        task: { ...task, assigneeUserId: OTHER_USER_ID },
        match: 'title',
        assigneeUserId: USER_ID,
      }),
    ).toMatchObject({
      status: 'done',
      assigneeUserId: null,
    });
  });

  it('does not propose done for closed unmerged pull requests', () => {
    const workItem = githubWorkItemFromIntegrationEvent({
      dedupKey: 'github:pr:11:closed',
      provider: 'github',
      externalObjectId: 'timborovkov/audit-ai#11',
      eventType: 'pr.closed',
      occurredAt: new Date('2026-06-01T12:00:00Z'),
      actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
      contentText: 'GitHub PR timborovkov/audit-ai#11 — Abandoned experiment',
      extra: {
        github: {
          type: 'pull_request',
          repo: 'timborovkov/audit-ai',
          number: 11,
          state: 'closed',
        },
      },
      objectMap: {
        type: 'task',
        canonicalName: 'timborovkov/audit-ai#11: Abandoned experiment',
        displayTitle: 'audit-ai: Abandoned experiment',
        externalId: 'timborovkov/audit-ai#11',
        status: 'cancelled',
      },
    });
    if (!workItem) throw new Error('expected work item');
    expect(
      planGithubTaskProposal({
        workItem,
        task: {
          id: '66666666-6666-4666-8666-666666666666',
          canonicalName: 'Abandoned experiment in audit-ai PR #11',
          aliases: [],
          metadata: {},
          status: 'todo',
          ownerUserId: null,
          assigneeUserId: null,
        },
        match: 'title',
        assigneeUserId: USER_ID,
      }),
    ).toMatchObject({
      status: null,
      assigneeUserId: USER_ID,
      ownerUserId: USER_ID,
    });
  });

  it('ignores GitHub comments and reviews instead of treating them as PR/issue work items', () => {
    expect(
      githubWorkItemFromRawMetadata(
        {
          provider: 'github',
          event_type: 'issue_comment.created',
          external_object_id: 'timborovkov/audit-ai#10:comment:99',
          actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
          github: {
            type: 'issue_comment',
            repo: 'timborovkov/audit-ai',
            parent: { type: 'pull_request', number: 10 },
          },
        },
        'Looks good, merging this.',
      ),
    ).toBeNull();
    expect(
      githubWorkItemFromIntegrationEvent({
        dedupKey: 'github:review:1',
        provider: 'github',
        externalObjectId: 'timborovkov/audit-ai#10:review:1',
        eventType: 'pr.review.approved',
        occurredAt: new Date('2026-06-01T12:00:00Z'),
        actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
        contentText: 'Approved',
        extra: {
          github: {
            type: 'review',
            repo: 'timborovkov/audit-ai',
            pr_number: 10,
            state: 'approved',
          },
        },
      }),
    ).toBeNull();
  });

  it('matches Linear captured-work completion by envelope objectMap aliases', () => {
    const workItem = capturedWorkItemFromIntegrationEvent({
      dedupKey: 'linear:issue:ENG-42:completed',
      provider: 'linear',
      externalObjectId: 'linear-issue-1',
      eventType: 'issue.completed',
      occurredAt: new Date('2026-06-01T12:00:00Z'),
      contentText: 'Linear ENG-42: Fix login',
      extra: { linear: { kind: 'issue', identifier: 'ENG-42' } },
      objectMap: {
        type: 'task',
        canonicalName: 'ENG-42: Fix login',
        displayTitle: 'Fix login',
        externalId: 'linear-issue-1',
        status: 'done',
        aliases: ['ENG-42'],
      },
    });
    if (!workItem) throw new Error('expected captured work item');
    expect(workItem.provider).toBe('linear');
    const matches = matchOpenTasksToCapturedWorkItem(workItem, [
      {
        id: '66666666-6666-4666-8666-666666666666',
        canonicalName: 'Fix login',
        aliases: ['ENG-42'],
        metadata: {},
        status: 'todo',
        ownerUserId: null,
        assigneeUserId: null,
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.match).toBe('alias');
    expect(matches[0]?.task.canonicalName).toBe('Fix login');
  });

  it('matches Monday captured-work completion by envelope objectMap aliases', () => {
    const workItem = capturedWorkItemFromIntegrationEvent({
      dedupKey: 'monday:item:1771812728:done',
      provider: 'monday',
      signalClass: 'captured_work',
      externalObjectId: '1771812728',
      eventType: 'item.updated',
      occurredAt: new Date('2026-06-01T12:00:00Z'),
      contentText: 'Monday item updated on Faba-ext: login QA',
      objectMap: {
        type: 'task',
        canonicalName: 'Monday record 1771812728: login QA',
        displayTitle: 'login QA',
        externalId: '1771812728',
        status: 'done',
        aliases: ['1771812728', 'monday:1771812728'],
      },
    });
    if (!workItem) throw new Error('expected captured work item');
    expect(workItem.provider).toBe('monday');
    const matches = matchOpenTasksToCapturedWorkItem(workItem, [
      {
        id: '77777777-7777-4777-8777-777777777777',
        canonicalName: 'Login QA',
        aliases: ['1771812728'],
        metadata: {},
        status: 'todo',
        ownerUserId: null,
        assigneeUserId: null,
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.match).toBe('alias');
  });

  it('does not treat Sentry incidents or GitHub workflow pulses as captured work', () => {
    expect(
      capturedWorkItemFromIntegrationEvent({
        dedupKey: 'sentry:issue:1',
        provider: 'sentry',
        externalObjectId: '1',
        eventType: 'issue.created',
        occurredAt: new Date('2026-06-01T12:00:00Z'),
        contentText: 'Sentry issue FABA-APP-1: TypeError',
        objectMap: {
          type: 'incident',
          canonicalName: 'FABA-APP-1: TypeError',
          externalId: '1',
          status: 'open',
          aliases: ['FABA-APP-1'],
        },
      }),
    ).toBeNull();
    expect(
      capturedWorkItemFromIntegrationEvent({
        dedupKey: 'github:workflow:1',
        provider: 'github',
        externalObjectId: 'acme/app#workflow_run:9',
        eventType: 'workflow_run.success',
        occurredAt: new Date('2026-06-01T12:00:00Z'),
        contentText: 'GitHub workflow CI #9 success',
        extra: { github: { type: 'workflow_run', repo: 'acme/app' } },
      }),
    ).toBeNull();
  });

  it('reconstructs merged PRs from stored raw-event metadata', () => {
    const workItem = githubWorkItemFromRawMetadata(
      {
        provider: 'github',
        event_type: 'pr.merged',
        external_object_id: 'timborovkov/audit-ai#88',
        actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
        github: {
          type: 'pull_request',
          repo: 'timborovkov/audit-ai',
          number: 88,
          merged_at: '2026-06-02T09:00:00Z',
          assignees: [{ login: 'taylorbennett' }],
        },
      },
      'GitHub PR timborovkov/audit-ai#88 — Fix command palette Engagements route 404',
    );
    expect(workItem).toMatchObject({
      kind: 'pull_request',
      number: 88,
      status: 'done',
      actorLogin: 'taylorbennett',
      assigneeLogins: ['taylorbennett'],
    });
  });
});

describe('GitHub task proposal persistence', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    vi.clearAllMocks();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'audit-ai', 'AuditAI');
      INSERT INTO users (id, email, name) VALUES
        ('${USER_ID}', 'taylor@example.com', 'Taylor Bennett'),
        ('${OTHER_USER_ID}', 'other@example.com', 'Other Person');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner'),
        ('${TEAM_ID}', '${OTHER_USER_ID}', 'member');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  // A merged owned PR is completed work even when no earlier conversation
  // created a task. Proposals remain reviewable and replay must be idempotent.
  it('reserves names across pending completed PR proposals so both approvals succeed', async () => {
    for (const repo of ['alpha', 'beta']) {
      await db.insert(entities).values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: repo,
        aliases: [`example/${repo}`],
        status: 'active',
      });
      const [event] = await db
        .insert(rawEvents)
        .values({
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'integration',
          visibility: 'team',
          occurredAt: new Date(),
          contentText: 'Merged: Improve navigation',
          sourceMetadata: {
            provider: 'github',
            signal_class: 'captured_work',
            event_type: 'pr.merged',
            external_object_id: `example/${repo}#42`,
            github: {
              type: 'pull_request',
              repo: `example/${repo}`,
              number: 42,
              merged_at: new Date().toISOString(),
              state: 'closed',
            },
            object_map: {
              type: 'task',
              canonicalName: 'Improve navigation',
              externalId: `example/${repo}#42`,
              status: 'done',
            },
          },
        })
        .returning();
      if (!event) throw new Error('missing event');
      await proposeGithubTaskUpdatesFromRawEvent({
        db: db as never,
        teamId: TEAM_ID,
        rawEvent: event,
      });
    }
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(2);
    expect(
      new Set(items.map((item) => (item.proposedPayload as Record<string, unknown>).canonicalName))
        .size,
    ).toBe(2);
    for (const item of items)
      expect(
        await withTeam(db as never, TEAM_ID, USER_ID).suggestions.acceptSuggestionItem(item.id),
      ).toBe(true);
    expect((await db.select().from(entities)).filter((row) => row.type === 'task')).toHaveLength(2);
  });

  it('preserves distinct same-title PR approvals within one repository project', async () => {
    const repo = 'alpha';
    await db.insert(entities).values({
      teamId: TEAM_ID,
      type: 'project',
      canonicalName: repo,
      aliases: [`example/${repo}`],
      status: 'active',
    });
    for (const number of [42, 43]) {
      const [event] = await db
        .insert(rawEvents)
        .values({
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'integration',
          visibility: 'team',
          occurredAt: new Date(),
          contentText: 'Merged: Improve navigation',
          sourceMetadata: {
            provider: 'github',
            signal_class: 'captured_work',
            event_type: 'pr.merged',
            external_object_id: `example/${repo}#${number}`,
            github: {
              type: 'pull_request',
              repo: `example/${repo}`,
              number,
              merged_at: new Date().toISOString(),
              state: 'closed',
            },
            object_map: {
              type: 'task',
              canonicalName: 'Improve navigation',
              externalId: `example/${repo}#${number}`,
              status: 'done',
            },
          },
        })
        .returning();
      if (!event) throw new Error('missing event');
      await proposeGithubTaskUpdatesFromRawEvent({
        db: db as never,
        teamId: TEAM_ID,
        rawEvent: event,
      });
    }
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.status === 'pending')).toBe(true);
    expect(
      new Set(items.map((item) => (item.proposedPayload as Record<string, unknown>).canonicalName))
        .size,
    ).toBe(2);
    for (const item of items)
      expect(
        await withTeam(db as never, TEAM_ID, USER_ID).suggestions.acceptSuggestionItem(item.id),
      ).toBe(true);
    expect((await db.select().from(entities)).filter((row) => row.type === 'task')).toHaveLength(2);
  });

  it('proposes a completed task under the uniquely named repository project', async () => {
    const [project] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: 'Northstar',
        aliases: ['northstar-frontend'],
        status: 'active',
      })
      .returning();
    if (!project) throw new Error('missing project');
    await db.insert(entities).values(
      Array.from({ length: 501 }, (_, index) => ({
        teamId: TEAM_ID,
        type: 'task' as const,
        canonicalName: `northstar-frontend historical work ${index}`,
        status: 'done',
      })),
    );

    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        visibility: 'team',
        occurredAt: new Date('2026-07-01T12:00:00Z'),
        contentText:
          'Merged PR: Add keyboard navigation to the client portal. The menu now supports arrow keys and Escape.',
        sourceMetadata: {
          provider: 'github',
          signal_class: 'captured_work',
          event_type: 'pr.merged',
          external_object_id: 'example/northstar-frontend#42',
          github: {
            type: 'pull_request',
            repo: 'example/northstar-frontend',
            number: 42,
            merged_at: '2026-07-01T12:00:00Z',
            state: 'closed',
          },
          object_map: {
            type: 'task',
            canonicalName: 'Add keyboard navigation for the client portal '.repeat(6),
            externalId: 'example/northstar-frontend#42',
            status: 'done',
          },
        },
      })
      .returning();
    if (!event) throw new Error('missing event');
    const [competingProject] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: 'Northstar mobile',
        aliases: ['northstar-frontend'],
        status: 'active',
      })
      .returning();
    if (!competingProject) throw new Error('missing competing project');
    expect(
      await proposeGithubTaskUpdatesFromRawEvent({
        db: db as never,
        teamId: TEAM_ID,
        rawEvent: event,
      }),
    ).toBe(0);
    await db.delete(entities).where(eq(entities.id, competingProject.id));
    const unmerged = {
      ...event,
      sourceMetadata: {
        ...(event.sourceMetadata as Record<string, unknown>),
        event_type: 'pr.closed',
        github: {
          type: 'pull_request',
          repo: 'example/northstar-frontend',
          number: 42,
          state: 'closed',
        },
        object_map: {
          type: 'task',
          canonicalName: 'Add keyboard navigation',
          externalId: 'example/northstar-frontend#42',
          status: 'cancelled',
        },
      },
    };
    expect(
      await proposeGithubTaskUpdatesFromRawEvent({
        db: db as never,
        teamId: TEAM_ID,
        rawEvent: unmerged,
      }),
    ).toBe(0);
    expect(
      await proposeGithubTaskUpdatesFromRawEvent({
        db: db as never,
        teamId: TEAM_ID,
        rawEvent: { ...event, visibility: 'private' },
      }),
    ).toBe(0);
    // Neither an unrelated title nor an archived task may collide on approval.
    const longTitle = 'Add keyboard navigation for the client portal '.repeat(6).trim();
    const clip = (value: string, length: number) =>
      value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;
    const suffix = ' (example/northstar-frontend#42)';
    const baseName = clip(longTitle, 200);
    const qualifiedName = `${clip(longTitle, 200 - suffix.length)}${suffix}`;
    await db.insert(entities).values([
      {
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: baseName,
        status: 'done',
        aliases: ['unrelated/work#98'],
      },
      {
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: qualifiedName,
        status: 'done',
        archivedAt: new Date(),
        aliases: ['unrelated/work#99'],
      },
    ]);
    await proposeGithubTaskUpdatesFromRawEvent({
      db: db as never,
      teamId: TEAM_ID,
      rawEvent: event,
    });
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      operation: 'create',
      targetKind: 'task',
      proposedPayload: { status: 'done', parentObjectId: project.id },
    });
    const item = items[0];
    if (!item) throw new Error('missing task proposal');
    expect((item.proposedPayload as Record<string, unknown>).aliases).toContain(
      'example/northstar-frontend#42',
    );
    expect(await db.select().from(agentSuggestionEvidence)).toHaveLength(1);
    await proposeGithubTaskUpdatesFromRawEvent({
      db: db as never,
      teamId: TEAM_ID,
      rawEvent: event,
    });
    expect(await db.select().from(agentSuggestionItems)).toHaveLength(1);
    expect((await db.select().from(entities)).filter((row) => row.type === 'task')).toHaveLength(
      503,
    );
    await withTeam(db as never, TEAM_ID, USER_ID).suggestions.acceptSuggestionItem(item.id);
    expect(
      await proposeGithubTaskUpdatesFromRawEvent({
        db: db as never,
        teamId: TEAM_ID,
        rawEvent: event,
      }),
    ).toBe(0);
    expect((await db.select().from(entities)).filter((row) => row.type === 'task')).toHaveLength(
      504,
    );
    const [acceptedTask] = (await db.select().from(entities)).filter(
      (row) =>
        row.type === 'task' &&
        row.aliases &&
        JSON.stringify(row.aliases).includes('example/northstar-frontend#42'),
    );
    expect(acceptedTask?.canonicalName).not.toBe(baseName);
    expect(acceptedTask?.canonicalName).not.toBe(qualifiedName);
    expect(acceptedTask?.canonicalName).toContain('example/northstar-frontend#42; 2');
    expect(acceptedTask?.canonicalName.length).toBeLessThanOrEqual(200);
    if (!acceptedTask) throw new Error('missing accepted task');
    await withTeam(db as never, TEAM_ID, USER_ID).objects.archiveObject(acceptedTask.id, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(
      await proposeGithubTaskUpdatesFromRawEvent({
        db: db as never,
        teamId: TEAM_ID,
        rawEvent: event,
      }),
    ).toBe(0);
    expect(await db.select().from(agentSuggestionItems)).toHaveLength(1);
  });

  it('proposes done and assignee for a merged GitHub PR that already has a Timeline task', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub — taylorbennett',
        externalAccountId: '42',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    // Closed repository history must not crowd an open task out of recall.
    await db.insert(entities).values(
      Array.from({ length: 500 }, (_, index) => ({
        teamId: TEAM_ID,
        type: 'task' as const,
        canonicalName: `audit-ai historical work ${index}`,
        status: 'done',
      })),
    );

    const [task] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Fix theme system detection broken until page reload in audit-ai PR #10',
        status: 'todo',
      })
      .returning();
    if (!task) throw new Error('task insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:10:merged',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#10',
          eventType: 'pr.merged',
          occurredAt: new Date('2026-06-01T12:00:00Z'),
          actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
          contentText:
            'GitHub PR timborovkov/audit-ai#10 — Fix theme system detection broken until page reload',
          extra: {
            github: {
              type: 'pull_request',
              repo: 'timborovkov/audit-ai',
              number: 10,
              merged_at: '2026-06-01T12:00:00Z',
              state: 'closed',
            },
          },
          objectMap: {
            type: 'task',
            canonicalName:
              'timborovkov/audit-ai#10: Fix theme system detection broken until page reload',
            displayTitle: 'audit-ai: Fix theme system detection broken until page reload',
            externalId: 'timborovkov/audit-ai#10',
            status: 'done',
            aliases: ['PR-timborovkov/audit-ai-10'],
          },
        },
      ],
    });

    expect(enqueueSuggestionJob).toHaveBeenCalledWith(
      {
        scope: 'github_task_proposal',
        teamId: TEAM_ID,
        integrationId: integration.id,
        externalObjectId: 'timborovkov/audit-ai#10',
      },
      { delayMs: GITHUB_TASK_PROPOSAL_COALESCE_MS },
    );

    const [taskRow] = await db.select().from(entities).where(eq(entities.id, task.id));
    expect(taskRow).toMatchObject({
      status: 'todo',
      assigneeUserId: null,
    });
    await expect(db.select().from(agentSuggestions)).resolves.toEqual([]);

    await proposeGithubTaskUpdatesForTeam({ db: db as never, teamId: TEAM_ID });

    const bundles = await db.select().from(agentSuggestions);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({
      title: `Update ${task.canonicalName}`,
      status: 'pending',
      source: 'background',
    });
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.targetKind).toBe('task');
    expect(items[0]?.targetId).toBe(task.id);
    expect(items[0]?.operation).toBe('update');
    expect(items[0]?.proposedPayload).toMatchObject({
      status: 'done',
      assigneeUserId: USER_ID,
    });
  });

  it('does not assign a GitHub-captured task to the connector when the actor is someone else', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub — taylorbennett',
        externalAccountId: '42',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [task] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Fix sidebar nav targeting wrong workspace in audit-ai PR #12',
        status: 'todo',
      })
      .returning();
    if (!task) throw new Error('task insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:12:merged',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#12',
          eventType: 'pr.merged',
          occurredAt: new Date('2026-06-01T12:00:00Z'),
          actor: { externalId: 'coworker', name: 'coworker' },
          contentText:
            'GitHub PR timborovkov/audit-ai#12 — Fix sidebar nav targeting wrong workspace',
          extra: {
            github: {
              type: 'pull_request',
              repo: 'timborovkov/audit-ai',
              number: 12,
              merged_at: '2026-06-01T12:00:00Z',
              assignees: [{ login: 'coworker' }],
            },
          },
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/audit-ai#12: Fix sidebar nav targeting wrong workspace',
            displayTitle: 'audit-ai: Fix sidebar nav targeting wrong workspace',
            externalId: 'timborovkov/audit-ai#12',
            status: 'done',
          },
        },
      ],
    });

    await proposeGithubTaskUpdatesForTeam({ db: db as never, teamId: TEAM_ID });

    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.proposedPayload).toMatchObject({ status: 'done' });
    expect(items[0]?.proposedPayload).not.toHaveProperty('assigneeUserId');
  });

  it('backfills merged GitHub clusters onto later Timeline tasks', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub — taylorbennett',
        externalAccountId: '42',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:88:merged',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#88',
          eventType: 'pr.merged',
          occurredAt: new Date('2026-06-02T09:00:00Z'),
          actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
          contentText:
            'GitHub PR timborovkov/audit-ai#88 — Fix command palette Engagements route 404',
          extra: {
            github: {
              type: 'pull_request',
              repo: 'timborovkov/audit-ai',
              number: 88,
              merged_at: '2026-06-02T09:00:00Z',
            },
          },
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/audit-ai#88: Fix command palette Engagements route 404',
            displayTitle: 'audit-ai: Fix command palette Engagements route 404',
            externalId: 'timborovkov/audit-ai#88',
            status: 'done',
          },
        },
      ],
    });

    await expect(db.select().from(agentSuggestions)).resolves.toEqual([]);

    const [task] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Fix command palette Engagements route 404 in audit-ai PR #88',
        status: 'todo',
      })
      .returning();
    if (!task) throw new Error('task insert failed');

    await proposeGithubTaskUpdatesForTeam({ db: db as never, teamId: TEAM_ID });

    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.targetId).toBe(task.id);
    expect(items[0]?.proposedPayload).toMatchObject({
      status: 'done',
      assigneeUserId: USER_ID,
    });
  });

  it('refreshes a pending create to done when the matching GitHub work item completes', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: OTHER_USER_ID,
        provider: 'github',
        displayName: 'GitHub — other-person',
        externalAccountId: '42',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [suggestion] = await db
      .insert(agentSuggestions)
      .values({
        teamId: TEAM_ID,
        source: 'background',
        title: 'Create theme-system task',
        dedupeKey: 'pending-theme-create',
        visibility: 'team',
        reason: 'Chat asked for a task.',
      })
      .returning();
    if (!suggestion) throw new Error('suggestion insert failed');
    await db.insert(agentSuggestionItems).values({
      suggestionId: suggestion.id,
      teamId: TEAM_ID,
      status: 'pending',
      operation: 'create',
      targetKind: 'task',
      title: 'Fix theme system detection broken until page reload in audit-ai PR #10',
      dedupeKey: 'pending-theme-create:item',
      proposedPayload: {
        canonicalName: 'Fix theme system detection broken until page reload in audit-ai PR #10',
        status: 'open',
      },
    });

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:10:merged',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#10',
          eventType: 'pr.merged',
          occurredAt: new Date('2026-06-01T12:00:00Z'),
          actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
          contentText:
            'GitHub PR timborovkov/audit-ai#10 — Fix theme system detection broken until page reload',
          extra: {
            github: {
              type: 'pull_request',
              repo: 'timborovkov/audit-ai',
              number: 10,
              merged_at: '2026-06-01T12:00:00Z',
              state: 'closed',
            },
          },
          objectMap: {
            type: 'task',
            canonicalName:
              'timborovkov/audit-ai#10: Fix theme system detection broken until page reload',
            displayTitle: 'audit-ai: Fix theme system detection broken until page reload',
            externalId: 'timborovkov/audit-ai#10',
            status: 'done',
            aliases: ['PR-timborovkov/audit-ai-10'],
          },
        },
      ],
    });

    await proposeGithubTaskUpdatesForTeam({ db: db as never, teamId: TEAM_ID });

    const bundles = await db.select().from(agentSuggestions);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.id).toBe(suggestion.id);
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      operation: 'create',
      targetKind: 'task',
      targetId: null,
    });
    expect(items[0]?.proposedPayload).toMatchObject({
      status: 'done',
      assigneeUserId: USER_ID,
    });
    const pendingPayload =
      items[0]?.proposedPayload && typeof items[0].proposedPayload === 'object'
        ? items[0].proposedPayload
        : {};
    const aliases = Object.hasOwn(pendingPayload, 'aliases')
      ? (pendingPayload as { aliases: unknown }).aliases
      : [];
    expect(Array.isArray(aliases) ? aliases : []).toContain('PR-timborovkov/audit-ai-10');
    const evidence = await db.select().from(agentSuggestionEvidence);
    expect(evidence).toHaveLength(1);
  });

  it('keeps a pending GitHub update alive when later evidence marks the work done', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub — taylorbennett',
        externalAccountId: '42',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [task] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Fix theme system detection broken until page reload in audit-ai PR #10',
        status: 'todo',
      })
      .returning();
    if (!task) throw new Error('task insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:10:opened',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#10',
          eventType: 'pr.opened',
          occurredAt: new Date('2026-06-01T11:00:00Z'),
          actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
          contentText:
            'GitHub PR timborovkov/audit-ai#10 — Fix theme system detection broken until page reload',
          extra: {
            github: {
              type: 'pull_request',
              repo: 'timborovkov/audit-ai',
              number: 10,
              state: 'open',
            },
          },
          objectMap: {
            type: 'task',
            canonicalName:
              'timborovkov/audit-ai#10: Fix theme system detection broken until page reload',
            displayTitle: 'audit-ai: Fix theme system detection broken until page reload',
            externalId: 'timborovkov/audit-ai#10',
            status: 'open',
            aliases: ['PR-timborovkov/audit-ai-10'],
          },
        },
      ],
    });
    await proposeGithubTaskUpdatesForTeam({ db: db as never, teamId: TEAM_ID });
    const firstItems = await db.select().from(agentSuggestionItems);
    expect(firstItems).toHaveLength(1);
    expect(firstItems[0]?.proposedPayload).toMatchObject({ assigneeUserId: USER_ID });
    expect(firstItems[0]?.proposedPayload).not.toMatchObject({ status: 'done' });
    const firstSuggestionId = firstItems[0]?.suggestionId;

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:10:merged',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#10',
          eventType: 'pr.merged',
          occurredAt: new Date('2026-06-01T12:00:00Z'),
          actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
          contentText:
            'GitHub PR timborovkov/audit-ai#10 — Fix theme system detection broken until page reload',
          extra: {
            github: {
              type: 'pull_request',
              repo: 'timborovkov/audit-ai',
              number: 10,
              merged_at: '2026-06-01T12:00:00Z',
              state: 'closed',
            },
          },
          objectMap: {
            type: 'task',
            canonicalName:
              'timborovkov/audit-ai#10: Fix theme system detection broken until page reload',
            displayTitle: 'audit-ai: Fix theme system detection broken until page reload',
            externalId: 'timborovkov/audit-ai#10',
            status: 'done',
            aliases: ['PR-timborovkov/audit-ai-10'],
          },
        },
      ],
    });
    await proposeGithubTaskUpdatesForTeam({ db: db as never, teamId: TEAM_ID });

    const bundles = await db.select().from(agentSuggestions);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.id).toBe(firstSuggestionId);
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.proposedPayload).toMatchObject({
      status: 'done',
      assigneeUserId: USER_ID,
    });
  });

  it('proposes done when a matching GitHub issue is closed', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub — taylorbennett',
        externalAccountId: '42',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [task] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Document the audit seed contract in audit-ai issue #22',
        status: 'todo',
      })
      .returning();
    if (!task) throw new Error('task insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:issue:22:closed',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#issue:22',
          eventType: 'issue.closed',
          occurredAt: new Date('2026-06-03T12:00:00Z'),
          actor: { externalId: 'taylorbennett', name: 'taylorbennett' },
          contentText: 'GitHub Issue timborovkov/audit-ai#22 — Document the audit seed contract',
          extra: {
            github: {
              type: 'issue',
              repo: 'timborovkov/audit-ai',
              number: 22,
              state: 'closed',
            },
          },
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/audit-ai#issue:22: Document the audit seed contract',
            displayTitle: 'audit-ai: Document the audit seed contract',
            externalId: 'timborovkov/audit-ai#issue:22',
            status: 'done',
            aliases: ['ISSUE-timborovkov/audit-ai-22'],
          },
        },
      ],
    });

    await proposeGithubTaskUpdatesForTeam({ db: db as never, teamId: TEAM_ID });
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.targetId).toBe(task.id);
    expect(items[0]?.proposedPayload).toMatchObject({ status: 'done' });
  });

  it('proposes done for Linear captured work matched only by task aliases', async () => {
    const [task] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Fix login',
        aliases: ['ENG-42'],
        status: 'todo',
      })
      .returning();
    if (!task) throw new Error('task insert failed');
    const [event] = await db
      .insert(rawEvents)
      .values({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa42',
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Linear ENG-42: Fix login',
        occurredAt: new Date('2026-06-01T12:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'linear',
          signal_class: 'captured_work',
          event_type: 'issue.completed',
          external_object_id: 'linear-issue-1',
          linear: { kind: 'issue', identifier: 'ENG-42' },
          object_map: {
            type: 'task',
            canonicalName: 'ENG-42: Fix login',
            displayTitle: 'Fix login',
            externalId: 'linear-issue-1',
            status: 'done',
            aliases: ['ENG-42'],
          },
        },
      })
      .returning();
    if (!event) throw new Error('raw event insert failed');

    const wrote = await proposeGithubTaskUpdatesFromRawEvent({
      db: db as never,
      teamId: TEAM_ID,
      rawEvent: event,
    });
    expect(wrote).toBe(1);
    const items = await db.select().from(agentSuggestionItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.targetId).toBe(task.id);
    expect(items[0]?.proposedPayload).toMatchObject({ status: 'done' });
  });
});
