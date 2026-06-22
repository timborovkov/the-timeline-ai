import { Buffer } from 'node:buffer';

import { PGlite } from '@electric-sql/pglite';
import {
  entities,
  integrations,
  rawEvents,
  slackConversationBindings,
  slackWorkspaces,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeIntegrationEvents } from '#src/integrations/event-writer.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', () => ({
  enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-job' }),
}));

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SLACK_WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';

describe('writeIntegrationEvents visibility', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team-a', 'Team A');
      INSERT INTO users (id, email) VALUES
        ('${USER_ID}', 'owner@example.com'),
        ('${USER_B_ID}', 'b@example.com');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner'),
        ('${TEAM_ID}', '${USER_B_ID}', 'member');
    `);
  });

  it('does not write specific_users without user ids for per-event overrides', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [eventId] = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:test:1',
          provider: 'github',
          externalObjectId: 'repo#1',
          eventType: 'test',
          occurredAt: new Date('2026-05-27T09:00:00Z'),
          contentText: 'specific override without ids',
          visibility: 'specific_users',
        },
      ],
    });
    if (!eventId) throw new Error('event insert failed');

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, eventId));
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityUserIds).toBeNull();
  });

  it('falls back to team visibility for specific_users defaults without user ids', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-default-specific',
        visibilityDefault: 'specific_users',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [eventId] = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:test:default-specific',
          provider: 'github',
          externalObjectId: 'repo#default-specific',
          eventType: 'test',
          occurredAt: new Date('2026-05-27T09:00:00Z'),
          contentText: 'specific default without ids',
        },
      ],
    });
    if (!eventId) throw new Error('event insert failed');

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, eventId));
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityUserIds).toBeNull();
  });

  it('uses event-level visibility user ids for specific_users overrides', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-specific',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [eventId] = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:test:2',
          provider: 'github',
          externalObjectId: 'repo#2',
          eventType: 'test',
          occurredAt: new Date('2026-05-27T09:00:00Z'),
          contentText: 'specific override with ids',
          visibility: 'specific_users',
          visibilityUserIds: [USER_B_ID],
        },
      ],
    });
    if (!eventId) throw new Error('event insert failed');

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, eventId));
    expect(row?.visibility).toBe('specific_users');
    expect(row?.visibilityUserIds).toEqual([USER_B_ID]);
  });

  it('skips native Slack message rows for conversationally bound channels', async () => {
    await db.insert(slackWorkspaces).values({
      id: SLACK_WORKSPACE_ID,
      slackTeamId: 'T_SLACK',
      name: 'Acme Slack',
      tokenCiphertext: Buffer.from('ciphertext'),
      tokenIv: Buffer.from('iv'),
      tokenTag: Buffer.from('tag'),
    });
    await db.insert(slackConversationBindings).values({
      workspaceId: SLACK_WORKSPACE_ID,
      teamId: TEAM_ID,
      slackConversationId: 'C_BOUND',
      conversationType: 'channel',
      title: 'bound',
      boundByUserId: USER_ID,
    });
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'slack',
        displayName: 'Slack',
        externalAccountId: 'T_SLACK',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const inserted = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'slack:message:T_SLACK:C_BOUND:1700000000.000100',
          provider: 'slack',
          externalObjectId: 'C_BOUND:1700000000.000100',
          externalEventId: '1700000000.000100',
          eventType: 'message.created',
          occurredAt: new Date('2026-05-27T09:00:00Z'),
          contentText: 'captured by conversational Slack',
          extra: {
            slack_team_id: 'T_SLACK',
            slack_channel_id: 'C_BOUND',
            slack_message_ts: '1700000000.000100',
          },
        },
        {
          dedupKey: 'slack:reaction:T_SLACK:C_BOUND:1700000000.000100:eyes',
          provider: 'slack',
          externalObjectId: 'C_BOUND:1700000000.000100',
          externalEventId: '1700000000.000100:eyes',
          eventType: 'reaction.added',
          occurredAt: new Date('2026-05-27T09:01:00Z'),
          contentText: 'Slack reaction :eyes:',
          extra: {
            slack_team_id: 'T_SLACK',
            slack_channel_id: 'C_BOUND',
            slack_message_ts: '1700000000.000100',
          },
        },
      ],
    });

    expect(inserted).toHaveLength(1);
    const rows = await db.select().from(rawEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contentText).toBe('Slack reaction :eyes:');
    expect(rows[0]?.sourceMetadata).toMatchObject({
      provider: 'slack',
      event_type: 'reaction.added',
    });
  });

  it('returns an empty insert result when every native Slack event belongs to a bound channel', async () => {
    await db.insert(slackWorkspaces).values({
      id: SLACK_WORKSPACE_ID,
      slackTeamId: 'T_SLACK',
      name: 'Acme Slack',
      tokenCiphertext: Buffer.from('ciphertext'),
      tokenIv: Buffer.from('iv'),
      tokenTag: Buffer.from('tag'),
    });
    await db.insert(slackConversationBindings).values({
      workspaceId: SLACK_WORKSPACE_ID,
      teamId: TEAM_ID,
      slackConversationId: 'C_BOUND',
      conversationType: 'channel',
      title: 'bound',
      boundByUserId: USER_ID,
    });
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'slack',
        displayName: 'Slack',
        externalAccountId: 'T_SLACK',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const inserted = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'slack:message:T_SLACK:C_BOUND:1700000000.000100',
          provider: 'slack',
          externalObjectId: 'C_BOUND:1700000000.000100',
          externalEventId: '1700000000.000100',
          eventType: 'message.created',
          occurredAt: new Date('2026-05-27T09:00:00Z'),
          contentText: 'captured by conversational Slack',
          extra: {
            slack_team_id: 'T_SLACK',
            slack_channel_id: 'C_BOUND',
            slack_message_ts: '1700000000.000100',
          },
        },
      ],
    });

    expect(inserted).toEqual([]);
    await expect(db.select().from(rawEvents)).resolves.toEqual([]);
  });

  it('falls back to team visibility for private integration events without a connector owner', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: null,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-ownerless',
        visibilityDefault: 'private',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [eventId] = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:test:3',
          provider: 'github',
          externalObjectId: 'repo#3',
          eventType: 'test',
          occurredAt: new Date('2026-05-27T09:00:00Z'),
          contentText: 'private default without connector owner',
        },
      ],
    });
    if (!eventId) throw new Error('event insert failed');

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, eventId));
    expect(row?.visibility).toBe('team');
    expect(row?.authorUserId).toBeNull();
    expect(row?.visibilityOwnerUserId).toBeNull();
  });

  it('stores integration object display titles separately from canonical names', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-display-title',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:202',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#202',
          eventType: 'pr.updated',
          occurredAt: new Date('2026-06-17T09:00:00Z'),
          contentText: 'GitHub PR timborovkov/the-timeline-ai#202 — Add cursor pagination',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            displayTitle: 'the-timeline-ai: Add cursor pagination',
            externalId: 'timborovkov/the-timeline-ai#202',
            status: 'open',
            url: 'https://github.com/timborovkov/the-timeline-ai/pull/202',
          },
        },
      ],
    });

    const [row] = await db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'timborovkov/the-timeline-ai#202: Add cursor pagination'));
    expect(row?.metadata).toMatchObject({
      integration_provider: 'github',
      integration_external_id: 'timborovkov/the-timeline-ai#202',
      display_title: 'the-timeline-ai: Add cursor pagination',
      display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
      url: 'https://github.com/timborovkov/the-timeline-ai/pull/202',
    });
  });

  it('does not let provider metadata override protected integration identity fields', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-protected-metadata',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:protected-metadata',
          provider: 'github',
          externalObjectId: 'real-external-id',
          eventType: 'issue.updated',
          occurredAt: new Date('2026-06-17T09:00:00Z'),
          contentText: 'GitHub issue with provider metadata',
          objectMap: {
            type: 'task',
            canonicalName: 'acme/app#7: Fix checkout',
            displayTitle: 'Fix checkout',
            externalId: 'real-external-id',
            metadata: {
              integration_provider: 'sentry',
              integration_external_id: 'fake-external-id',
              provider_specific_key: 'kept',
            },
          },
        },
      ],
    });

    const [row] = await db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'acme/app#7: Fix checkout'));
    expect(row?.metadata).toMatchObject({
      integration_provider: 'github',
      integration_external_id: 'real-external-id',
      provider_specific_key: 'kept',
    });
  });

  it('does not overwrite a user-renamed integration object on later syncs', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-display-title-rename',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:202:first',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#202',
          eventType: 'pr.updated',
          occurredAt: new Date('2026-06-17T09:00:00Z'),
          contentText: 'GitHub PR timborovkov/the-timeline-ai#202 — Add cursor pagination',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            displayTitle: 'the-timeline-ai: Add cursor pagination',
            externalId: 'timborovkov/the-timeline-ai#202',
            status: 'open',
            url: 'https://github.com/timborovkov/the-timeline-ai/pull/202',
          },
        },
      ],
    });

    const [created] = await db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'timborovkov/the-timeline-ai#202: Add cursor pagination'));
    if (!created) throw new Error('object insert failed');

    await db
      .update(entities)
      .set({ canonicalName: 'Use cursor pagination in the task board' })
      .where(eq(entities.id, created.id));

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:202:second',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#202',
          eventType: 'pr.closed',
          occurredAt: new Date('2026-06-17T10:00:00Z'),
          contentText:
            'GitHub PR timborovkov/the-timeline-ai#202 — Add cursor pagination with next page',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination with next page',
            displayTitle: 'the-timeline-ai: Add cursor pagination with next page',
            externalId: 'timborovkov/the-timeline-ai#202',
            status: 'done',
            url: 'https://github.com/timborovkov/the-timeline-ai/pull/202',
          },
        },
      ],
    });

    const [row] = await db.select().from(entities).where(eq(entities.id, created.id));
    expect(row?.canonicalName).toBe('Use cursor pagination in the task board');
    expect(row?.status).toBe('done');
    expect(row?.metadata).toMatchObject({
      display_title: 'the-timeline-ai: Add cursor pagination with next page',
      display_title_canonical_name:
        'timborovkov/the-timeline-ai#202: Add cursor pagination with next page',
      last_event_type: 'pr.closed',
    });
  });

  it('preserves legacy user-renamed integration objects that predate display title markers', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-legacy-rename',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [existing] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Use cursor pagination in the task board',
        status: 'todo',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#202',
        },
      })
      .returning();
    if (!existing) throw new Error('object insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:202:legacy-rename',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#202',
          eventType: 'pr.updated',
          occurredAt: new Date('2026-06-17T10:00:00Z'),
          contentText: 'GitHub PR timborovkov/the-timeline-ai#202 — Add cursor pagination',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            displayTitle: 'the-timeline-ai: Add cursor pagination',
            externalId: 'timborovkov/the-timeline-ai#202',
            status: 'open',
          },
        },
      ],
    });

    const [row] = await db.select().from(entities).where(eq(entities.id, existing.id));
    expect(row?.canonicalName).toBe('Use cursor pagination in the task board');
    expect(row?.metadata).toMatchObject({
      integration_provider: 'github',
      integration_external_id: 'timborovkov/the-timeline-ai#202',
      last_event_type: 'pr.updated',
    });
    expect(row?.metadata).not.toHaveProperty('display_title');
    expect(row?.metadata).not.toHaveProperty('display_title_canonical_name');
  });

  it('preserves legacy provider-shaped canonical names that predate display title markers', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-legacy-provider-name',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [existing] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'timborovkov/the-timeline-ai#202: Old provider title',
        status: 'open',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#202',
        },
      })
      .returning();
    if (!existing) throw new Error('object insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:202:legacy-provider-name',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#202',
          eventType: 'pr.updated',
          occurredAt: new Date('2026-06-17T10:00:00Z'),
          contentText: 'GitHub PR timborovkov/the-timeline-ai#202 — New provider title',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: New provider title',
            displayTitle: 'the-timeline-ai: New provider title',
            externalId: 'timborovkov/the-timeline-ai#202',
            status: 'open',
          },
        },
      ],
    });

    const [row] = await db.select().from(entities).where(eq(entities.id, existing.id));
    expect(row?.canonicalName).toBe('timborovkov/the-timeline-ai#202: Old provider title');
    expect(row?.metadata).toMatchObject({
      integration_provider: 'github',
      integration_external_id: 'timborovkov/the-timeline-ai#202',
      last_event_type: 'pr.updated',
    });
    expect(row?.metadata).not.toHaveProperty('display_title');
    expect(row?.metadata).not.toHaveProperty('display_title_canonical_name');
  });

  it('updates marker-backed GitHub issue canonical names despite issue external ids', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-marker-backed-github-issue',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [existing] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'timborovkov/the-timeline-ai#202: Old issue title',
        status: 'open',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#issue:202',
          display_title: 'the-timeline-ai: Old issue title',
          display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Old issue title',
        },
      })
      .returning();
    if (!existing) throw new Error('object insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:issue:202:marker-backed',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#issue:202',
          eventType: 'issue.updated',
          occurredAt: new Date('2026-06-17T10:00:00Z'),
          contentText: 'GitHub Issue timborovkov/the-timeline-ai#202 — New issue title',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: New issue title',
            displayTitle: 'the-timeline-ai: New issue title',
            externalId: 'timborovkov/the-timeline-ai#issue:202',
            status: 'open',
          },
        },
      ],
    });

    const [row] = await db.select().from(entities).where(eq(entities.id, existing.id));
    expect(row?.canonicalName).toBe('timborovkov/the-timeline-ai#202: New issue title');
    expect(row?.metadata).toMatchObject({
      display_title: 'the-timeline-ai: New issue title',
      display_title_canonical_name: 'timborovkov/the-timeline-ai#202: New issue title',
    });
  });

  it('skips integration canonical name updates that would collide with another object', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-canonical-collision',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [existing] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'timborovkov/the-timeline-ai#202: Old provider title',
        status: 'open',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#202',
          display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Old provider title',
        },
      })
      .returning();
    if (!existing) throw new Error('object insert failed');

    const [conflicting] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'timborovkov/the-timeline-ai#202: New provider title',
        status: 'todo',
        metadata: {},
      })
      .returning();
    if (!conflicting) throw new Error('conflicting object insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:202:canonical-collision',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#202',
          eventType: 'pr.closed',
          occurredAt: new Date('2026-06-17T10:00:00Z'),
          contentText: 'GitHub PR timborovkov/the-timeline-ai#202 — New provider title',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: New provider title',
            displayTitle: 'the-timeline-ai: New provider title',
            externalId: 'timborovkov/the-timeline-ai#202',
            status: 'done',
          },
        },
      ],
    });

    const [blocked] = await db.select().from(entities).where(eq(entities.id, existing.id));
    expect(blocked?.canonicalName).toBe('timborovkov/the-timeline-ai#202: Old provider title');
    expect(blocked?.status).toBe('done');
    expect(blocked?.metadata).toMatchObject({
      display_title: 'the-timeline-ai: New provider title',
      display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Old provider title',
      display_title_canonical_name_collision: 'timborovkov/the-timeline-ai#202: New provider title',
      last_event_type: 'pr.closed',
    });

    await db
      .update(entities)
      .set({ mergedIntoId: existing.id })
      .where(eq(entities.id, conflicting.id));

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:202:canonical-collision-retry',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#202',
          eventType: 'pr.reopened',
          occurredAt: new Date('2026-06-17T11:00:00Z'),
          contentText: 'GitHub PR timborovkov/the-timeline-ai#202 — New provider title',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#202: New provider title',
            displayTitle: 'the-timeline-ai: New provider title',
            externalId: 'timborovkov/the-timeline-ai#202',
            status: 'open',
          },
        },
      ],
    });

    const [row] = await db.select().from(entities).where(eq(entities.id, existing.id));
    expect(row?.canonicalName).toBe('timborovkov/the-timeline-ai#202: New provider title');
    expect(row?.status).toBe('open');
    expect(row?.metadata).toMatchObject({
      display_title: 'the-timeline-ai: New provider title',
      display_title_canonical_name: 'timborovkov/the-timeline-ai#202: New provider title',
      last_event_type: 'pr.reopened',
    });
    expect(row?.metadata).not.toHaveProperty('display_title_canonical_name_collision');
  });

  it('preserves user-renamed integration objects while a provider rename is blocked', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'acct-user-rename-collision',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const [existing] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Use cursor pagination in the task board',
        status: 'open',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#203',
          display_title_canonical_name: 'timborovkov/the-timeline-ai#203: Add cursor pagination',
        },
      })
      .returning();
    if (!existing) throw new Error('object insert failed');

    await db.insert(entities).values({
      teamId: TEAM_ID,
      type: 'task',
      canonicalName: 'timborovkov/the-timeline-ai#203: New provider title',
      status: 'todo',
      metadata: {},
    });

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:pr:203:user-rename-collision',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#203',
          eventType: 'pr.closed',
          occurredAt: new Date('2026-06-17T10:00:00Z'),
          contentText: 'GitHub PR timborovkov/the-timeline-ai#203 — New provider title',
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#203: New provider title',
            displayTitle: 'the-timeline-ai: New provider title',
            externalId: 'timborovkov/the-timeline-ai#203',
            status: 'done',
          },
        },
      ],
    });

    const [row] = await db.select().from(entities).where(eq(entities.id, existing.id));
    expect(row?.canonicalName).toBe('Use cursor pagination in the task board');
    expect(row?.status).toBe('done');
    expect(row?.metadata).toMatchObject({
      display_title: 'the-timeline-ai: New provider title',
      display_title_canonical_name: 'timborovkov/the-timeline-ai#203: New provider title',
      last_event_type: 'pr.closed',
    });
    expect(row?.metadata).not.toHaveProperty('display_title_canonical_name_collision');
  });
});
