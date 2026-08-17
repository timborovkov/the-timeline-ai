import { PGlite } from '@electric-sql/pglite';
import { agentSuggestionItems, agentSuggestions, entities, integrations } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeIntegrationEvents } from '#src/integrations/event-writer.js';
import {
  compactGithubPersonKey,
  githubLoginFromConnectionDisplayName,
  githubWorkItemFromIntegrationEvent,
  githubWorkItemFromRawMetadata,
  matchOpenTasksToGithubWorkItem,
  planGithubTaskProposal,
  proposeGithubTaskUpdatesForTeam,
  resolveGithubLoginToUserId,
} from '#src/integrations/github-task-proposals.js';
import { enqueueSuggestionJob } from '#src/queue/queues.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', () => ({
  enqueueExtractJob: vi.fn().mockResolvedValue(undefined),
  enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-job' }),
  enqueueSuggestionJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'proposal-job' }),
}));

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
    actor: { externalId: 'timborovkov', name: 'timborovkov' },
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
    expect(githubLoginFromConnectionDisplayName('GitHub — timborovkov')).toBe('timborovkov');
    expect(githubLoginFromConnectionDisplayName('GitHub - octocat')).toBe('octocat');
    expect(githubLoginFromConnectionDisplayName('GitHub')).toBeNull();
  });

  it('maps GitHub logins through connection ownership before name compaction', () => {
    const members = [
      { userId: USER_ID, name: 'Tim Borovkov' },
      { userId: OTHER_USER_ID, name: 'Other Person' },
    ];
    expect(
      resolveGithubLoginToUserId('timborovkov', members, new Map([[USER_ID, ['timborovkov']]])),
    ).toBe(USER_ID);
    expect(resolveGithubLoginToUserId('timborovkov', members, new Map())).toBe(USER_ID);
    expect(compactGithubPersonKey('Tim Borovkov')).toBe('timborovkov');
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
        [{ userId: USER_ID, name: 'Tim Borovkov' }],
        new Map([[USER_ID, ['timborovkov']]]),
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
      actor: { externalId: 'timborovkov', name: 'timborovkov' },
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
          actor: { externalId: 'timborovkov', name: 'timborovkov' },
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
        actor: { externalId: 'timborovkov', name: 'timborovkov' },
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

  it('reconstructs merged PRs from stored raw-event metadata', () => {
    const workItem = githubWorkItemFromRawMetadata(
      {
        provider: 'github',
        event_type: 'pr.merged',
        external_object_id: 'timborovkov/audit-ai#88',
        actor: { externalId: 'timborovkov', name: 'timborovkov' },
        github: {
          type: 'pull_request',
          repo: 'timborovkov/audit-ai',
          number: 88,
          merged_at: '2026-06-02T09:00:00Z',
          assignees: [{ login: 'timborovkov' }],
        },
      },
      'GitHub PR timborovkov/audit-ai#88 — Fix command palette Engagements route 404',
    );
    expect(workItem).toMatchObject({
      kind: 'pull_request',
      number: 88,
      status: 'done',
      actorLogin: 'timborovkov',
      assigneeLogins: ['timborovkov'],
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
        ('${USER_ID}', 'tim@example.com', 'Tim Borovkov'),
        ('${OTHER_USER_ID}', 'other@example.com', 'Other Person');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner'),
        ('${TEAM_ID}', '${OTHER_USER_ID}', 'member');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('proposes done and assignee for a merged GitHub PR that already has a Timeline task', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub — timborovkov',
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
          dedupKey: 'github:pr:10:merged',
          provider: 'github',
          externalObjectId: 'timborovkov/audit-ai#10',
          eventType: 'pr.merged',
          occurredAt: new Date('2026-06-01T12:00:00Z'),
          actor: { externalId: 'timborovkov', name: 'timborovkov' },
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
      { delayMs: expect.any(Number) },
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
        displayName: 'GitHub — timborovkov',
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
        displayName: 'GitHub — timborovkov',
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
          actor: { externalId: 'timborovkov', name: 'timborovkov' },
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
});
