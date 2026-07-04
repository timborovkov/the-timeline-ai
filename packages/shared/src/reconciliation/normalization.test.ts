import { PGlite } from '@electric-sql/pglite';
import {
  eventSource,
  integrations,
  rawEvents,
  reconciliationEvidence,
  reconciliationEvidenceAnchors,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeIntegrationEvents } from '#src/integrations/event-writer.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', () => ({
  enqueueExtractJob: vi.fn().mockResolvedValue(undefined),
  enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-job' }),
}));

const TEAM_ID = '11111111-1111-1111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OBJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('reconciliation source normalization', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'reconcile-normalize', 'Reconcile Normalize');
      INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('persists inline source snapshots when provider events omit payload refs', async () => {
    const [integration] = await db
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
    if (!integration) throw new Error('integration insert failed');

    const [rawEventId] = await writeIntegrationEvents({
      db: db as never,
      integration,
      events: [
        {
          dedupKey: 'sentry:issue:no-payload-ref',
          provider: 'sentry',
          externalObjectId: 'issue-no-payload',
          eventType: 'issue.updated',
          occurredAt: new Date('2026-06-21T09:00:00Z'),
          contentText: 'Sentry issue without a retained provider payload ref',
          extra: {
            provider: 'wrong-provider',
            source_payload_ref: '',
            payload_digest: '',
            source_snapshot_kind: 'stale-adapter-value',
            external_url: 'https://sentry.example/issues/no-payload',
          },
        },
      ],
    });
    if (!rawEventId) throw new Error('raw event insert failed');

    const [raw] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId));
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, rawEventId));

    expect(raw?.source).toBe('integration');
    const metadata = raw?.sourceMetadata as {
      source_payload_ref?: string;
      payload_digest?: string;
      provider?: string;
      source_snapshot_kind?: string;
      source_snapshot_version?: string;
      source_snapshot?: {
        dedupKey?: string;
        provider?: string;
        externalObjectId?: string;
        eventType?: string;
        contentText?: string;
      };
    };
    expect(metadata.provider).toBe('sentry');
    expect(metadata.source_payload_ref).toMatch(/^inline:\/\/timeline\/integration\/sentry\//);
    expect(metadata.payload_digest).toMatch(/^sha256:/);
    expect(metadata.source_snapshot_kind).toBe('normalized_integration_event');
    expect(metadata.source_snapshot_version).toBe('integration-source-snapshot-2026-06');
    expect(metadata.source_snapshot).toMatchObject({
      dedupKey: 'sentry:issue:no-payload-ref',
      provider: 'sentry',
      externalObjectId: 'issue-no-payload',
      eventType: 'issue.updated',
      contentText: 'Sentry issue without a retained provider payload ref',
    });
    expect(evidence).toMatchObject({
      rawEventId,
      provider: 'sentry',
      externalObjectId: 'issue-no-payload',
      replayState: 'full',
      sourcePayloadRef: metadata.source_payload_ref,
      payloadDigest: metadata.payload_digest,
      sourceUrl: 'https://sentry.example/issues/no-payload',
    });
    expect(evidence?.metadata).toMatchObject({
      replay_degraded_reason: null,
    });
    const anchors = await db
      .select()
      .from(reconciliationEvidenceAnchors)
      .where(eq(reconciliationEvidenceAnchors.evidenceId, evidence?.id ?? ''));
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'url',
          anchorValue: 'https://sentry.example/issues/no-payload',
          strength: 'hard',
        }),
      ]),
    );
  });

  it('normalizes non-integration raw events across conversational and webhook surfaces', async () => {
    const inserted = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'email',
          contentText: 'Forwarded Acme thread: Nora approved the launch workaround.',
          occurredAt: new Date('2026-06-22T09:00:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            message_id: '<acme-approval@example.test>',
            subject: 'Fwd: Acme launch workaround',
            from_email: 'nora@acme.example',
            raw_postmark: {
              MessageID: '<acme-approval@example.test>',
              TextBody: 'Nora approved the launch workaround.',
            },
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'slack',
          contentText: 'Slack thread says Sentry ISSUE-789 is fixed.',
          occurredAt: new Date('2026-06-22T09:05:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            slack_workspace_id: 'T_ACME',
            slack_channel_id: 'C_IMPL',
            slack_message_ts: '1780000000.000100',
            slack_thread_ts: '1780000000.000000',
            slack_user_id: 'U_NORA',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'telegram',
          contentText: 'Telegram voice transcript: customer wants Monday updated.',
          occurredAt: new Date('2026-06-22T09:10:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            tg_chat_id: 12345,
            tg_message_id: 67890,
            tg_update_id: 999,
            tg_user_id: 555,
            tg_username: 'nora_acme',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: null,
          source: 'ingest_webhook',
          contentText: 'Webhook Customer Portal: Acme renewal risk changed to high.',
          occurredAt: new Date('2026-06-22T09:15:00Z'),
          visibility: 'team',
          sourceMetadata: {
            ingest_webhook_id: 'webhook-acme',
            ingest_webhook_name: 'Customer Portal',
            ingest_webhook_body_sha256: 'sha256-acme-portal',
            ingest_webhook_dedup_key: 'webhook-acme:2026-06-22:sha',
            artifact_key: 'customer:acme:renewal',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'system',
          contentText: 'Created task: Review Acme rollout',
          occurredAt: new Date('2026-06-22T09:20:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            kind: 'object_create',
            entity_id: OBJECT_ID,
            actor_kind: 'user',
          },
        },
      ])
      .returning({ id: rawEvents.id, source: rawEvents.source });

    const evidenceIds = await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: inserted.map((row) => row.id),
    });
    expect(evidenceIds).toHaveLength(5);

    const retryIds = await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: inserted.map((row) => row.id),
    });
    expect(retryIds).toHaveLength(5);

    const evidence = await db.select().from(reconciliationEvidence);
    expect(evidence).toHaveLength(5);
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'email',
          provider: 'email',
          externalObjectId: '<acme-approval@example.test>',
          eventType: 'email.received',
          replayState: 'full',
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
        }),
        expect.objectContaining({
          source: 'slack',
          provider: 'slack',
          externalObjectId: 'T_ACME:C_IMPL:1780000000.000100',
          eventType: 'slack.message',
          replayState: 'degraded',
        }),
        expect.objectContaining({
          source: 'telegram',
          provider: 'telegram',
          externalObjectId: '12345:67890',
          externalEventId: '999',
          eventType: 'telegram.message',
          replayState: 'degraded',
        }),
        expect.objectContaining({
          source: 'ingest_webhook',
          provider: 'ingest_webhook',
          externalObjectId: 'webhook-acme:2026-06-22:sha',
          eventType: 'ingest_webhook.received',
          payloadDigest: 'sha256-acme-portal',
          replayState: 'full',
        }),
        expect.objectContaining({
          source: 'system',
          provider: 'system',
          externalObjectId: OBJECT_ID,
          eventType: 'system.object_create',
          replayState: 'degraded',
        }),
      ]),
    );

    const anchors = await db.select().from(reconciliationEvidenceAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'email_domain',
          anchorValue: 'acme.example',
        }),
        expect.objectContaining({
          anchorType: 'slack_thread',
          anchorValue: '1780000000.000000',
        }),
        expect.objectContaining({
          anchorType: 'telegram_user',
          anchorValue: '555',
        }),
        expect.objectContaining({
          anchorType: 'artifact_key',
          anchorValue: 'customer:acme:renewal',
          strength: 'hard',
        }),
        expect.objectContaining({
          anchorType: 'object',
          anchorValue: OBJECT_ID,
        }),
      ]),
    );
  });

  it('normalizes every raw event source enum into evidence', async () => {
    const inserted = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'web',
          contentText: 'Manual web note about Acme rollout risk.',
          occurredAt: new Date('2026-06-23T09:00:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            title: 'Acme rollout risk',
            source_object_id: 'web-note-acme-rollout',
            source_payload_ref: 'inline://timeline/web/web-note-acme-rollout',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'telegram',
          contentText: 'Telegram update about the Acme rollout.',
          occurredAt: new Date('2026-06-23T09:01:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            tg_chat_id: 12345,
            tg_message_id: 1001,
            tg_update_id: 9001,
            tg_user_id: 555,
            tg_username: 'nora_acme',
            source_payload_ref: 'inline://timeline/telegram/12345/1001',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'email',
          contentText: 'Forwarded Acme rollout email.',
          occurredAt: new Date('2026-06-23T09:02:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            message_id: '<all-sources-acme@example.test>',
            from_email: 'nora@acme.example',
            subject: 'Acme rollout',
            source_payload_ref: 's3://timeline-test/email/all-sources-acme.eml',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'system',
          contentText: 'Created object Acme rollout.',
          occurredAt: new Date('2026-06-23T09:03:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            kind: 'object_create',
            entity_id: OBJECT_ID,
            source_payload_ref: `inline://timeline/system/object_create/${OBJECT_ID}`,
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'document',
          contentText: 'Document activity for Acme rollout plan.',
          occurredAt: new Date('2026-06-23T09:04:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            document_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            document_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            document_title: 'Acme rollout plan',
            source_payload_ref: 's3://timeline-test/documents/acme-rollout-v1.pdf',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'meeting',
          contentText: 'Meeting summary: Acme rollout stays on track.',
          occurredAt: new Date('2026-06-23T09:05:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            meeting_chunk_provider_id: 'recall-acme-rollout-001',
            meeting_title: 'Acme rollout sync',
            source_payload_ref: 's3://timeline-test/meetings/acme-rollout-transcript.txt',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'integration',
          contentText: 'GitHub PR linked to Acme rollout.',
          occurredAt: new Date('2026-06-23T09:06:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            provider: 'github',
            event_type: 'pull_request.updated',
            external_object_id: 'timeline/acme#42',
            dedup_key: 'github:timeline/acme:pr:42:updated',
            source_payload_ref: 's3://timeline-test/github/pr-42.json',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'calendar',
          contentText: 'Acme rollout review on the calendar.',
          occurredAt: new Date('2026-06-23T09:07:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            calendar_event_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            action: 'event',
            calendar_title: 'Acme rollout review',
            source_payload_ref: 'inline://timeline/calendar/acme-rollout-review',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'slack',
          contentText: 'Slack thread about Acme rollout.',
          occurredAt: new Date('2026-06-23T09:08:00Z'),
          visibility: 'team',
          visibilityOwnerUserId: USER_ID,
          sourceMetadata: {
            slack_workspace_id: 'T_ALL_SOURCES',
            slack_channel_id: 'C_ACME',
            slack_message_ts: '1810000000.000100',
            slack_thread_ts: '1810000000.000000',
            slack_user_id: 'U_NORA',
            source_payload_ref: 's3://timeline-test/slack/acme-rollout-thread.json',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: null,
          source: 'ingest_webhook',
          contentText: 'Customer portal webhook for Acme rollout.',
          occurredAt: new Date('2026-06-23T09:09:00Z'),
          visibility: 'team',
          sourceMetadata: {
            ingest_webhook_id: 'webhook-all-sources',
            ingest_webhook_name: 'Customer Portal',
            ingest_webhook_body_sha256: 'sha256-all-sources-webhook',
            ingest_webhook_dedup_key: 'webhook-all-sources:2026-06-23',
            artifact_key: 'customer:acme:rollout',
          },
        },
      ])
      .returning({ id: rawEvents.id });

    const evidenceIds = await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: inserted.map((row) => row.id),
    });
    expect(evidenceIds).toHaveLength(eventSource.enumValues.length);

    const evidence = await db.select().from(reconciliationEvidence);
    expect(evidence.map((row) => row.source).sort()).toEqual([...eventSource.enumValues].sort());
    expect(evidence.every((row) => row.replayState === 'full')).toBe(true);
    expect(evidence.every((row) => row.dedupeKey.startsWith('reconcile:evidence:'))).toBe(true);
    expect(evidence.map((row) => row.rawEventId).sort()).toEqual(
      inserted.map((row) => row.id).sort(),
    );
  });
});
