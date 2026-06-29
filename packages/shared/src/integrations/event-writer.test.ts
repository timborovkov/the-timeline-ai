import { Buffer } from 'node:buffer';

import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusterAnchors,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  integrations,
  rawEvents,
  reconciliationEvidence,
  reconciliationEvidenceAnchors,
  reconciliationOutputs,
  reconciliationRuns,
  slackConversationBindings,
  slackWorkspaces,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeIntegrationEvents } from '#src/integrations/event-writer.js';
import { AUTHORITY_POLICY_VERSION } from '#src/reconciliation/authority.js';
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

  afterEach(async () => {
    await pg.close();
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

  it('normalizes integration events into replay-safe reconciliation evidence and anchors', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'monday',
        displayName: 'Monday + Sentry',
        externalAccountId: 'acct-reconcile-shadow',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const events = [
      {
        dedupKey: 'monday:item:456:status',
        provider: 'monday',
        externalObjectId: 'board-123:item-456',
        externalEventId: 'evt-monday-1',
        eventType: 'item.status_changed',
        occurredAt: new Date('2026-06-20T09:00:00Z'),
        contentText: 'Monday item Acme implementation moved to Waiting on Customer',
        extra: {
          source_payload_ref: 's3://timeline-test/reconciliation/monday/item-456.json',
          payload_digest: 'sha256:monday-payload',
        },
        objectMap: {
          type: 'task' as const,
          canonicalName: 'Acme implementation board item',
          displayTitle: 'Acme implementation',
          externalId: 'board-123:item-456',
          status: 'in_progress' as const,
          aliases: ['ACME-IMPL'],
          url: 'https://monday.com/boards/123/pulses/456',
          metadata: { artifact_key: 'customer:acme:implementation' },
        },
      },
      {
        dedupKey: 'monday:item:999:comment',
        provider: 'monday',
        externalObjectId: 'board-123:item-999',
        externalEventId: 'evt-monday-comment-1',
        eventType: 'comment.created',
        occurredAt: new Date('2026-06-20T09:10:00Z'),
        contentText: 'Monday comment on Acme rollout notes: customer asked for rollout notes',
        extra: {
          source_payload_ref: 's3://timeline-test/reconciliation/monday/item-999-comment.json',
          payload_digest: 'sha256:monday-comment-payload',
        },
        objectMap: {
          type: 'task' as const,
          canonicalName: 'Acme rollout notes board item',
          displayTitle: 'Acme rollout notes',
          externalId: 'board-123:item-999',
          status: 'open' as const,
          metadata: { artifact_key: 'customer:acme:rollout-notes' },
        },
      },
      {
        dedupKey: 'sentry:issue:789:resolved',
        provider: 'sentry',
        externalObjectId: 'issue-789',
        externalEventId: 'evt-sentry-1',
        eventType: 'issue.resolved',
        occurredAt: new Date('2026-06-20T09:05:00Z'),
        contentText: 'Sentry issue ISSUE-789 login crash resolved',
        extra: {
          source_payload_ref: 's3://timeline-test/reconciliation/sentry/issue-789.json',
          payload_digest: 'sha256:sentry-payload',
          url: 'https://sentry.example/issues/789',
        },
      },
    ];

    const insertedIds = await writeIntegrationEvents({
      db: db as never,
      integration,
      events,
    });
    expect(insertedIds).toHaveLength(3);

    const retryIds = await writeIntegrationEvents({
      db: db as never,
      integration,
      events,
    });
    expect(retryIds).toEqual([]);

    const evidenceRows = await db
      .select()
      .from(reconciliationEvidence)
      .orderBy(reconciliationEvidence.provider);
    expect(evidenceRows).toHaveLength(3);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'monday',
          externalObjectId: 'board-123:item-456',
          eventType: 'item.status_changed',
          replayState: 'full',
          sourcePayloadRef: 's3://timeline-test/reconciliation/monday/item-456.json',
          payloadDigest: 'sha256:monday-payload',
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
        }),
        expect.objectContaining({
          provider: 'monday',
          externalObjectId: 'board-123:item-999',
          eventType: 'comment.created',
          replayState: 'full',
          sourcePayloadRef: 's3://timeline-test/reconciliation/monday/item-999-comment.json',
          payloadDigest: 'sha256:monday-comment-payload',
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
        }),
        expect.objectContaining({
          provider: 'sentry',
          externalObjectId: 'issue-789',
          eventType: 'issue.resolved',
          replayState: 'full',
          sourcePayloadRef: 's3://timeline-test/reconciliation/sentry/issue-789.json',
          payloadDigest: 'sha256:sentry-payload',
        }),
      ]),
    );

    const anchors = await db.select().from(reconciliationEvidenceAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'provider_object',
          anchorValue: 'monday:board-123:item-456',
          source: 'adapter',
        }),
        expect.objectContaining({
          anchorType: 'provider_object',
          anchorValue: 'monday:board-123:item-999',
          source: 'adapter',
        }),
        expect.objectContaining({
          anchorType: 'provider_object',
          anchorValue: 'sentry:issue-789',
          source: 'adapter',
        }),
        expect.objectContaining({
          anchorType: 'artifact_key',
          anchorValue: 'customer:acme:implementation',
          strength: 'hard',
        }),
        expect.objectContaining({
          anchorType: 'alias:task',
          anchorValue: 'acme-impl',
        }),
      ]),
    );

    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toHaveLength(2);
    const lifecycleAssociation = associations.find((row) => row.role === 'lifecycle_update');
    const contextAssociation = associations.find((row) => row.role === 'related_context');
    expect(lifecycleAssociation).toMatchObject({
      role: 'lifecycle_update',
      strength: 'structured',
      associationSource: 'authoritative_provider',
      visibility: 'team',
      visibilityFloor: 'team',
      visibilityOwnerUserId: USER_ID,
      visibilityFloorOwnerUserId: USER_ID,
    });
    expect(lifecycleAssociation?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'monday',
        rawEventId: lifecycleAssociation?.rawEventId,
        evidenceId: evidenceRows.find((row) => row.eventType === 'item.status_changed')?.id,
        sourcePayloadRef: 's3://timeline-test/reconciliation/monday/item-456.json',
      }),
    ]);
    expect(contextAssociation).toMatchObject({
      role: 'related_context',
      strength: 'structured',
      associationSource: 'hard_anchor',
      visibility: 'team',
      visibilityFloor: 'team',
      visibilityOwnerUserId: USER_ID,
      visibilityFloorOwnerUserId: USER_ID,
    });
    expect(contextAssociation?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'monday',
        rawEventId: contextAssociation?.rawEventId,
        evidenceId: evidenceRows.find((row) => row.eventType === 'comment.created')?.id,
        sourcePayloadRef: 's3://timeline-test/reconciliation/monday/item-999-comment.json',
      }),
    ]);

    const runs = await db.select().from(reconciliationRuns);
    expect(runs).toHaveLength(2);
    const directRun = runs.find((row) => row.scope === 'integration_direct_write');
    const observedRun = runs.find((row) => row.scope === 'integration_observed_association');
    expect(directRun).toMatchObject({
      teamId: TEAM_ID,
      trigger: 'raw_event',
      scope: 'integration_direct_write',
      status: 'completed',
      engineVersion: 'integration-direct-write-2026-06',
    });
    expect(observedRun).toMatchObject({
      teamId: TEAM_ID,
      trigger: 'raw_event',
      scope: 'integration_observed_association',
      status: 'completed',
      engineVersion: 'integration-observed-association-2026-06',
    });

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(2);
    const directOutput = outputs.find((row) => row.outputKind === 'direct_write');
    const observedOutput = outputs.find((row) => row.outputKind === 'observed_association');
    expect(directOutput).toMatchObject({
      runId: directRun?.id,
      clusterId: lifecycleAssociation?.clusterId,
      outputKind: 'direct_write',
      targetKind: 'cluster_lifecycle',
      operation: 'update',
      requiresApproval: false,
      status: 'applied',
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
      visibilityFloor: 'team',
      visibilityFloorOwnerUserId: USER_ID,
    });
    expect(directOutput?.authorityDecision).toMatchObject({
      decision: 'direct_write',
      reason: 'provider_owns_external_object_state',
      provider: 'monday',
      policy_version: AUTHORITY_POLICY_VERSION,
    });
    expect(directOutput?.payload).toMatchObject({
      provider: 'monday',
      event_type: 'item.status_changed',
      object_map_external_id: 'board-123:item-456',
      object_map_status: 'in_progress',
      cluster_status: 'active',
      association_role: 'lifecycle_update',
    });
    expect(directOutput?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'monday',
        rawEventId: lifecycleAssociation?.rawEventId,
        evidenceId: evidenceRows.find((row) => row.eventType === 'item.status_changed')?.id,
        sourcePayloadRef: 's3://timeline-test/reconciliation/monday/item-456.json',
      }),
    ]);
    expect(directOutput?.sourcePayloadRefs).toEqual([
      's3://timeline-test/reconciliation/monday/item-456.json',
    ]);

    expect(observedOutput).toMatchObject({
      runId: observedRun?.id,
      clusterId: contextAssociation?.clusterId,
      outputKind: 'observed_association',
      targetKind: 'cluster_identity',
      operation: 'link',
      requiresApproval: false,
      status: 'applied',
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
      visibilityFloor: 'team',
      visibilityFloorOwnerUserId: USER_ID,
    });
    expect(observedOutput?.authorityDecision).toMatchObject({
      decision: 'observed_association',
      reason: 'context_attached_without_canonical_state_change',
      provider: 'monday',
      policy_version: AUTHORITY_POLICY_VERSION,
    });
    expect(observedOutput?.payload).toMatchObject({
      provider: 'monday',
      event_type: 'comment.created',
      integration_id: integration.id,
      external_object_id: 'board-123:item-999',
      object_map_external_id: 'board-123:item-999',
      object_map_type: 'task',
      association_role: 'related_context',
      association_source: 'hard_anchor',
      evidence_strength: 'structured',
    });
    expect(observedOutput?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'monday',
        rawEventId: contextAssociation?.rawEventId,
        evidenceId: evidenceRows.find((row) => row.eventType === 'comment.created')?.id,
        sourcePayloadRef: 's3://timeline-test/reconciliation/monday/item-999-comment.json',
      }),
    ]);
    expect(observedOutput?.sourcePayloadRefs).toEqual([
      's3://timeline-test/reconciliation/monday/item-999-comment.json',
    ]);
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
        {
          dedupKey: 'slack:file:T_SLACK:C_BOUND:1700000000.000100:F_BOUND',
          provider: 'slack',
          externalObjectId: 'F_BOUND',
          externalEventId: '1700000000.000100:F_BOUND',
          eventType: 'file.shared',
          occurredAt: new Date('2026-05-27T09:02:00Z'),
          contentText: 'Slack file shared: roadmap.pdf',
          extra: {
            slack_team_id: 'T_SLACK',
            slack_channel_id: 'C_BOUND',
            slack_message_ts: '1700000000.000100',
            slack_file_id: 'F_BOUND',
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

  it('clusters technical evidence across Sentry and GitHub when a shared incident key appears', async () => {
    const [sentryIntegration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'sentry',
        displayName: 'Sentry',
        externalAccountId: 'sentry-acct',
        visibilityDefault: 'team',
      })
      .returning();
    const [githubIntegration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'github-acct',
        visibilityDefault: 'team',
      })
      .returning();
    if (!sentryIntegration || !githubIntegration) throw new Error('integration insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration: sentryIntegration,
      events: [
        {
          dedupKey: 'sentry:issue:100:first',
          provider: 'sentry',
          externalObjectId: '100',
          eventType: 'issue.updated',
          occurredAt: new Date('2026-06-18T10:00:00Z'),
          contentText: 'Sentry issue TIMELINE-AI-100: Login fails on mobile',
          extra: {
            sentry_issue_id: '100',
            sentry_short_id: 'TIMELINE-AI-100',
          },
          objectMap: {
            type: 'incident',
            canonicalName: 'TIMELINE-AI-100: Login fails on mobile',
            displayTitle: 'Login fails on mobile',
            externalId: '100',
            status: 'open',
            aliases: ['TIMELINE-AI-100'],
          },
        },
      ],
    });

    await writeIntegrationEvents({
      db: db as never,
      integration: githubIntegration,
      events: [
        {
          dedupKey: 'github:pr:77:fix-sentry',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#77',
          eventType: 'pr.merged',
          occurredAt: new Date('2026-06-18T11:00:00Z'),
          contentText:
            'GitHub PR timborovkov/the-timeline-ai#77 — Fix mobile login crash\n\nFixes TIMELINE-AI-100',
          extra: {
            github: {
              type: 'pull_request',
              repo: 'timborovkov/the-timeline-ai',
              number: 77,
              url: 'https://github.com/timborovkov/the-timeline-ai/pull/77',
              state: 'closed',
              merged_at: '2026-06-18T11:00:00Z',
              head: 'fix/mobile-login',
            },
          },
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#77: Fix mobile login crash',
            displayTitle: 'the-timeline-ai: Fix mobile login crash',
            externalId: 'timborovkov/the-timeline-ai#77',
            status: 'done',
            url: 'https://github.com/timborovkov/the-timeline-ai/pull/77',
          },
        },
      ],
    });

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.artifactType).toBe('incident');
    expect(clusters[0]?.status).toBe('resolved');

    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toHaveLength(2);
    expect(associations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'lifecycle_update',
          associationSource: 'authoritative_provider',
        }),
        expect.objectContaining({
          role: 'blocker',
          associationSource: 'authoritative_provider',
        }),
      ]),
    );

    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'sentry_short_id',
          anchorValue: 'timeline-ai-100',
        }),
        expect.objectContaining({
          anchorType: 'github_pr',
          anchorValue: 'timborovkov/the-timeline-ai#77',
        }),
      ]),
    );
  });

  it('repairs artifact evidence on duplicate webhook replay when raw event already exists', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'github-replay-acct',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const event = {
      dedupKey: 'github:issue:911:closed',
      provider: 'github',
      externalObjectId: 'timborovkov/the-timeline-ai#911',
      eventType: 'issue.closed',
      occurredAt: new Date('2026-06-18T12:00:00Z'),
      contentText: 'GitHub issue timborovkov/the-timeline-ai#911 closed',
      extra: {
        github: {
          type: 'issue',
          repo: 'timborovkov/the-timeline-ai',
          number: 911,
        },
      },
      objectMap: {
        type: 'task',
        canonicalName: 'timborovkov/the-timeline-ai#911: Fix artifact repair',
        displayTitle: 'the-timeline-ai: Fix artifact repair',
        externalId: 'timborovkov/the-timeline-ai#911',
        status: 'done',
      },
    } as const;

    const insertedIds = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [event],
    });
    expect(insertedIds).toHaveLength(1);

    await db.delete(artifactClusters);
    expect(await db.select().from(artifactEvidenceAssociations)).toHaveLength(0);
    expect(await db.select().from(artifactClusterAnchors)).toHaveLength(0);

    const replayedIds = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [event],
    });
    expect(replayedIds).toEqual([]);

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      canonicalName: 'the-timeline-ai: Fix artifact repair',
      status: 'resolved',
    });
    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toEqual([
      expect.objectContaining({
        rawEventId: insertedIds[0],
        role: 'lifecycle_update',
        associationSource: 'authoritative_provider',
      }),
    ]);
  });

  it('records artifact evidence even when workspace object mapping is skipped by a name conflict', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'github-conflict-acct',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    await db.insert(entities).values({
      teamId: TEAM_ID,
      type: 'task',
      canonicalName: 'timborovkov/the-timeline-ai#912: Existing manual object',
      status: 'open',
      metadata: {},
    });

    const insertedIds = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:issue:912:conflict',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#912',
          eventType: 'issue.updated',
          occurredAt: new Date('2026-06-18T12:30:00Z'),
          contentText: 'GitHub issue timborovkov/the-timeline-ai#912 updated',
          extra: {
            github: {
              type: 'issue',
              repo: 'timborovkov/the-timeline-ai',
              number: 912,
            },
          },
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#912: Existing manual object',
            displayTitle: 'the-timeline-ai: Existing manual object',
            externalId: 'timborovkov/the-timeline-ai#912',
            status: 'open',
          },
        },
      ],
    });
    expect(insertedIds).toHaveLength(1);

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      canonicalName: 'the-timeline-ai: Existing manual object',
      status: 'open',
    });

    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toEqual([
      expect.objectContaining({
        rawEventId: insertedIds[0],
        role: 'blocker',
        associationSource: 'authoritative_provider',
      }),
    ]);
    expect(associations[0]?.metadata).toMatchObject({
      external_object_id: 'timborovkov/the-timeline-ai#912',
    });

    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'github_issue',
          anchorValue: 'timborovkov/the-timeline-ai#912',
        }),
      ]),
    );
  });

  it('keeps every same-object raw event as artifact evidence within one batch', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'github',
        displayName: 'GitHub',
        externalAccountId: 'github-same-object-batch',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const insertedIds = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'github:issue:913:opened',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#913',
          eventType: 'issue.updated',
          occurredAt: new Date('2026-06-18T12:00:00Z'),
          contentText: 'GitHub issue timborovkov/the-timeline-ai#913 opened',
          extra: {
            github: {
              type: 'issue',
              repo: 'timborovkov/the-timeline-ai',
              number: 913,
            },
          },
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#913: Preserve batch evidence',
            displayTitle: 'the-timeline-ai: Preserve batch evidence',
            externalId: 'timborovkov/the-timeline-ai#913',
            status: 'open',
          },
        },
        {
          dedupKey: 'github:issue:913:closed',
          provider: 'github',
          externalObjectId: 'timborovkov/the-timeline-ai#913',
          eventType: 'issue.closed',
          occurredAt: new Date('2026-06-18T12:05:00Z'),
          contentText: 'GitHub issue timborovkov/the-timeline-ai#913 closed',
          extra: {
            github: {
              type: 'issue',
              repo: 'timborovkov/the-timeline-ai',
              number: 913,
            },
          },
          objectMap: {
            type: 'task',
            canonicalName: 'timborovkov/the-timeline-ai#913: Preserve batch evidence',
            displayTitle: 'the-timeline-ai: Preserve batch evidence',
            externalId: 'timborovkov/the-timeline-ai#913',
            status: 'done',
          },
        },
      ],
    });
    expect(insertedIds).toHaveLength(2);

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.status).toBe('resolved');

    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations.map((association) => association.rawEventId).sort()).toEqual(
      [...insertedIds].sort(),
    );
    expect(associations.map((association) => association.role).sort()).toEqual([
      'blocker',
      'lifecycle_update',
    ]);
  });

  it('clusters non-technical work artifacts with explicit artifact keys without granting authority to context', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'monday',
        displayName: 'Monday',
        externalAccountId: 'monday-acct',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'monday:contract:first',
          provider: 'monday',
          externalObjectId: 'contract-item-1',
          eventType: 'item.updated',
          occurredAt: new Date('2026-06-19T10:00:00Z'),
          contentText: 'Contract tracker item: Acme master services agreement is in legal review',
          objectMap: {
            type: 'document',
            canonicalName: 'Acme master services agreement',
            externalId: 'contract-item-1',
            status: 'in_progress',
            metadata: {
              artifact_key: 'contract:acme-msa-2026',
              contract_id: 'ACME-MSA-2026',
            },
          },
        },
        {
          dedupKey: 'monday:contract:comment',
          provider: 'monday',
          externalObjectId: 'comment-2',
          eventType: 'update.created',
          occurredAt: new Date('2026-06-19T11:00:00Z'),
          contentText:
            'Legal said the Acme MSA can go out for signature after pricing appendix update',
          objectMap: {
            type: 'document',
            canonicalName: 'Acme MSA legal update',
            externalId: 'comment-2',
            status: 'open',
            metadata: {
              artifact_key: 'contract:acme-msa-2026',
            },
          },
        },
      ],
    });

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.artifactType).toBe('document');

    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toHaveLength(2);
    expect(
      associations.some(
        (association) => association.associationSource === 'authoritative_provider',
      ),
    ).toBe(false);
    expect(associations.map((association) => association.role)).toEqual([
      'evidence_only',
      'evidence_only',
    ]);

    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'artifact_key',
          anchorValue: 'contract:acme-msa-2026',
        }),
        expect.objectContaining({
          anchorType: 'contract_id',
          anchorValue: 'acme-msa-2026',
        }),
      ]),
    );
  });
});
