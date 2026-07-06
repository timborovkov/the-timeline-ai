import { PGlite } from '@electric-sql/pglite';
import {
  calendarEvents,
  documentChunks,
  documents,
  documentVersions,
  entities,
  meetings,
  meetingTranscriptChunks,
  objectSummaries,
  rawEvents,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderRawEventForAi } from '#src/embedding/raw-event-renderer.js';
import { buildEmbeddingPlan } from '#src/embedding/sources.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team', 'Team');
    INSERT INTO users (id, email) VALUES ('${USER_ID}', 'user@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
}

describe('embedding source plans', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('skips non-team raw events and stamps the skip metadata', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000001';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'private note',
      occurredAt: new Date('2026-05-26T10:00:00Z'),
      visibility: 'private',
      sourceMetadata: {},
    });

    await expect(
      buildEmbeddingPlan(db as never, { scope: 'raw_event', teamId: TEAM_ID, rawEventId }, 'event'),
    ).resolves.toBeNull();

    const rows = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId));
    expect(rows[0]?.sourceMetadata).toMatchObject({
      embedding_skipped_reason: 'visibility=private',
    });
  });

  it('stamps integration raw events as integration_event source kind', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000002';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: 'Linear issue moved to Done',
      occurredAt: new Date('2026-05-26T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: { provider: 'linear' },
    });

    const plan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      'event',
    );

    expect(plan?.sourceKind).toBe('integration_event');
    expect(plan?.payloadOverrides).toMatchObject({ source: 'integration', event_id: rawEventId });
  });

  it('renders Telegram sender context into raw event embedding text', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000003';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Acme asked for the SOC2 report by Friday',
      occurredAt: new Date('2026-05-26T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        tg_chat_type: 'supergroup',
        tg_chat_title: 'sales',
        tg_sender_name: 'Alice Example',
        tg_username: 'alice',
      },
    });

    const plan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      'event',
    );

    expect(plan?.text).toContain(
      'Source context: Telegram | supergroup | sender Alice Example | chat sales',
    );
    expect(plan?.text).toContain('Message:\nAcme asked for the SOC2 report by Friday');
  });

  it('renders Slack sender, conversation, thread, and attachments into raw event embedding text', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000004';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'slack',
      contentText: 'Can someone review the contract?',
      occurredAt: new Date('2026-05-26T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        slack_channel_type: 'channel',
        slack_channel_name: 'legal',
        slack_sender_name: 'Alice Example',
        slack_message_ts: '1716717600.000100',
        slack_thread_ts: '1716717600.000200',
        attachments: [{ name: 'contract.pdf' }],
      },
    });

    const plan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      'event',
    );

    expect(plan?.text).toContain(
      'Source context: Slack | channel | sender Alice Example | conversation legal',
    );
    expect(plan?.text).toContain('attachments contract.pdf');
    expect(plan?.text).toContain('Message:\nCan someone review the contract?');
  });

  it('renders email sender, subject, forwarded sender, and attachments into raw event embedding text', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000005';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'email',
      contentText: 'The customer approved the launch checklist.',
      occurredAt: new Date('2026-05-26T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        subject: 'Fwd: Launch checklist',
        from: { email: 'ops@example.net', name: 'Ops Vendor' },
        forwarded_from: {
          from: { email: 'ada@acme.example', name: 'Ada Lovelace' },
          subject: 'Launch checklist',
        },
        attachments: [{ filename: 'rollout-plan.pdf', content_type: 'application/pdf' }],
      },
    });

    const plan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      'event',
    );

    expect(plan?.text).toContain(
      'Source context: Email | subject Fwd: Launch checklist | from Ops Vendor <ops@example.net>',
    );
    expect(plan?.text).toContain('forwarded from Ada Lovelace <ada@acme.example>');
    expect(plan?.text).toContain('attachments rollout-plan.pdf');
    expect(plan?.text).toContain('Message:\nThe customer approved the launch checklist.');
  });

  it('renders integration provider, event, actor, ids, URL, and provider fields into raw event embedding text', async () => {
    const sentryEventId = '10000000-0000-0000-0000-000000000006';
    const mondayEventId = '10000000-0000-0000-0000-000000000007';
    await db.insert(rawEvents).values({
      id: sentryEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: 'Sentry issue WEB-789 was resolved after the auth fix.',
      occurredAt: new Date('2026-05-26T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        provider: 'sentry',
        event_type: 'issue.resolved',
        external_object_id: 'issue-789',
        external_event_id: 'evt-sentry-1',
        actor: { name: 'Sentry Bot', externalId: 'bot-1' },
        url: 'https://sentry.example/issues/789',
        sentry_issue_id: '789',
        sentry_short_id: 'WEB-789',
        level: 'error',
        status: 'unresolved',
        count: '17',
        user_count: 4,
        metadata: { type: 'Error', value: 'Checkout failed', filename: 'checkout.ts' },
      },
    });

    const sentryPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: sentryEventId },
      'event',
    );

    expect(sentryPlan?.sourceKind).toBe('integration_event');
    expect(sentryPlan?.text).toContain(
      'Source context: Sentry | event issue.resolved | external object issue-789',
    );
    expect(sentryPlan?.text).toContain('external event evt-sentry-1');
    expect(sentryPlan?.text).toContain('actor Sentry Bot');
    expect(sentryPlan?.text).toContain('url https://sentry.example/issues/789');
    expect(sentryPlan?.text).toContain('Sentry issue 789');
    expect(sentryPlan?.text).toContain('Sentry short id WEB-789');
    expect(sentryPlan?.text).toContain('Sentry level error');
    expect(sentryPlan?.text).toContain('Sentry status unresolved');
    expect(sentryPlan?.text).toContain('Sentry events 17');
    expect(sentryPlan?.text).toContain('Sentry users 4');
    expect(sentryPlan?.text).toContain('Sentry error type Error');
    expect(sentryPlan?.text).toContain('Sentry error value Checkout failed');
    expect(sentryPlan?.text).toContain('Sentry filename checkout.ts');
    expect(sentryPlan?.text).toContain(
      'Message:\nSentry issue WEB-789 was resolved after the auth fix.',
    );

    await db.insert(rawEvents).values({
      id: mondayEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: 'Monday item Acme rollout moved to Shipped.',
      occurredAt: new Date('2026-05-26T10:05:00Z'),
      visibility: 'team',
      sourceMetadata: {
        provider: 'monday',
        event_type: 'item.updated',
        external_object_id: 'item-456',
        external_event_id: 'update-99',
        actor: { externalId: 'user-1' },
        external_url: 'https://monday.example/boards/board-1/pulses/item-456',
        monday_workspace_name: 'Customer Success',
        monday_board_name: 'Customer Projects',
        monday_board_id: 'board-1',
        monday_item_name: 'Acme rollout',
        monday_item_id: 'item-456',
        monday_parent_item_name: 'Northstar Renewal',
        monday_record_kind: 'item',
        monday_columns: [
          { id: 'status', title: 'Status', type: 'status', text: 'Waiting on Customer' },
          { id: 'owner', title: 'Owner', type: 'people', text: 'Ada Lovelace' },
          { id: 'date4', title: 'Renewal Date', type: 'date', text: '2026-07-06' },
        ],
      },
    });

    const mondayPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: mondayEventId },
      'event',
    );

    expect(mondayPlan?.sourceKind).toBe('integration_event');
    expect(mondayPlan?.text).toContain(
      'Source context: Monday.com | event item.updated | external object item-456',
    );
    expect(mondayPlan?.text).toContain('external event update-99');
    expect(mondayPlan?.text).toContain('actor user-1');
    expect(mondayPlan?.text).toContain('url https://monday.example/boards/board-1/pulses/item-456');
    expect(mondayPlan?.text).toContain('Monday workspace Customer Success');
    expect(mondayPlan?.text).toContain('Monday board Customer Projects');
    expect(mondayPlan?.text).toContain('Monday item Acme rollout');
    expect(mondayPlan?.text).toContain('Monday parent item Northstar Renewal');
    expect(mondayPlan?.text).toContain('Monday record kind item');
    expect(mondayPlan?.text).toContain('Monday column Status (status) Waiting on Customer');
    expect(mondayPlan?.text).toContain('Monday column Owner (people) Ada Lovelace');
    expect(mondayPlan?.text).toContain('Monday column Renewal Date (date) 2026-07-06');
    expect(mondayPlan?.text).toContain('Message:\nMonday item Acme rollout moved to Shipped.');
  });

  it('renders nested GitHub, Linear, and Drive provider metadata into raw event embedding text', async () => {
    const githubEventId = '10000000-0000-0000-0000-000000000008';
    const linearEventId = '10000000-0000-0000-0000-000000000009';
    const driveEventId = '10000000-0000-0000-0000-000000000010';
    const githubWorkflowEventId = '10000000-0000-0000-0000-000000000011';
    await db.insert(rawEvents).values([
      {
        id: githubEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'GitHub PR acme/app#42 is ready for review.',
        occurredAt: new Date('2026-05-26T10:10:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'github',
          event_type: 'pr.updated',
          external_object_id: 'acme/app#42',
          github: {
            type: 'pull_request',
            repo: 'acme/app',
            number: 42,
            url: 'https://github.com/acme/app/pull/42',
            state: 'open',
            base: 'main',
            head: 'northstar-renewal',
          },
        },
      },
      {
        id: linearEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Linear APP-42 is blocked on customer confirmation.',
        occurredAt: new Date('2026-05-26T10:15:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'linear',
          event_type: 'issue.updated',
          external_object_id: 'linear-issue-42',
          linear: {
            kind: 'issue',
            identifier: 'APP-42',
            url: 'https://linear.app/acme/issue/APP-42/customer-confirmation',
            state: { name: 'Blocked', type: 'started' },
            priority: 2,
            priority_label: 'High',
            team: { key: 'APP', name: 'App Team' },
            project: { name: 'Customer Launch' },
            parent: { identifier: 'APP-1', title: 'Northstar Migration' },
          },
        },
      },
      {
        id: driveEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Drive launch plan was modified.',
        occurredAt: new Date('2026-05-26T10:20:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'google_drive',
          event_type: 'file.changed',
          external_object_id: 'drive-file-42',
          actor: { name: 'Ada Lovelace', email: 'ada@example.com' },
          drive: {
            name: 'Launch Plan',
            mime_type: 'application/vnd.google-apps.document',
            web_view_link: 'https://drive.google.com/file/d/drive-file-42/view',
            modified_time: '2026-05-26T10:20:00.000Z',
            drive_id: 'shared-drive-1',
            parents: ['folder-1', 'folder-2'],
          },
        },
      },
      {
        id: githubWorkflowEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'GitHub workflow CI failed on acme/app.',
        occurredAt: new Date('2026-05-26T10:25:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'github',
          event_type: 'workflow_run.failure',
          external_object_id: 'acme/app#workflow_run:99',
          github: {
            type: 'workflow_run',
            repo: 'acme/app',
            url: 'https://github.com/acme/app/actions/runs/99',
            status: 'completed',
            conclusion: 'failure',
            head_branch: 'northstar-renewal',
            head_sha: 'abcdef1234567890',
            event: 'pull_request',
          },
        },
      },
    ]);

    const githubPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: githubEventId },
      'event',
    );
    const linearPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: linearEventId },
      'event',
    );
    const drivePlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: driveEventId },
      'event',
    );
    const githubWorkflowPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: githubWorkflowEventId },
      'event',
    );

    expect(githubPlan?.text).toContain(
      'Source context: GitHub | event pr.updated | external object acme/app#42',
    );
    expect(githubPlan?.text).toContain('url https://github.com/acme/app/pull/42');
    expect(githubPlan?.text).toContain('GitHub type pull_request');
    expect(githubPlan?.text).toContain('GitHub repo acme/app');
    expect(githubPlan?.text).toContain('GitHub number 42');
    expect(githubPlan?.text).toContain('GitHub state open');
    expect(githubPlan?.text).toContain('GitHub base main');
    expect(githubPlan?.text).toContain('GitHub head northstar-renewal');
    expect(linearPlan?.text).toContain(
      'Source context: Linear | event issue.updated | external object linear-issue-42',
    );
    expect(linearPlan?.text).toContain(
      'url https://linear.app/acme/issue/APP-42/customer-confirmation',
    );
    expect(linearPlan?.text).toContain('Linear kind issue');
    expect(linearPlan?.text).toContain('Linear issue APP-42');
    expect(linearPlan?.text).toContain('Linear team App Team');
    expect(linearPlan?.text).toContain('Linear project Customer Launch');
    expect(linearPlan?.text).toContain('Linear state Blocked');
    expect(linearPlan?.text).toContain('Linear priority High');
    expect(linearPlan?.text).toContain('Linear parent APP-1');
    expect(drivePlan?.text).toContain(
      'Source context: Google Drive | event file.changed | external object drive-file-42',
    );
    expect(drivePlan?.text).toContain('actor Ada Lovelace <ada@example.com>');
    expect(drivePlan?.text).toContain('url https://drive.google.com/file/d/drive-file-42/view');
    expect(drivePlan?.text).toContain('Drive file Launch Plan');
    expect(drivePlan?.text).toContain('Drive mime application/vnd.google-apps.document');
    expect(drivePlan?.text).toContain('Drive modified 2026-05-26T10:20:00.000Z');
    expect(drivePlan?.text).toContain('Drive shared drive shared-drive-1');
    expect(drivePlan?.text).toContain('Drive parents folder-1, folder-2');
    expect(githubWorkflowPlan?.text).toContain('GitHub type workflow_run');
    expect(githubWorkflowPlan?.text).toContain('GitHub status completed');
    expect(githubWorkflowPlan?.text).toContain('GitHub conclusion failure');
    expect(githubWorkflowPlan?.text).toContain('GitHub head northstar-renewal');
    expect(githubWorkflowPlan?.text).toContain('GitHub event pull_request');
  });

  it('renders web, meeting, document, calendar, webhook, and system metadata into raw event embedding text', async () => {
    const webEventId = '10000000-0000-0000-0000-000000000012';
    const meetingEventId = '10000000-0000-0000-0000-000000000013';
    const documentEventId = '10000000-0000-0000-0000-000000000014';
    const calendarEventId = '10000000-0000-0000-0000-000000000015';
    const webhookEventId = '10000000-0000-0000-0000-000000000016';
    const systemEventId = '10000000-0000-0000-0000-000000000017';
    await db.insert(rawEvents).values([
      {
        id: webEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Manual note: Acme renewal risk is blocked on legal.',
        occurredAt: new Date('2026-05-26T10:30:00Z'),
        visibility: 'team',
        sourceMetadata: {
          event_type: 'manual_note',
          source_object_id: 'web-note-acme-renewal',
          source_url: 'https://timeline.example/events/web-note-acme-renewal',
        },
      },
      {
        id: meetingEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'meeting',
        contentText: 'Ada: Legal owns the Acme renewal review.',
        occurredAt: new Date('2026-05-26T10:35:00Z'),
        visibility: 'team',
        sourceMetadata: {
          meeting_id: 'meeting-acme-renewal',
          meeting_title: 'Acme Renewal Review',
          platform: 'recall',
          speakers: ['Ada Lovelace', 'Grace Hopper'],
          duration_minutes: 32,
          chunk_count: 4,
          summary: 'Legal owns the renewal review before launch.',
          partial_capture: true,
        },
      },
      {
        id: documentEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'document',
        contentText: 'Uploaded Acme Renewal Plan.pdf',
        occurredAt: new Date('2026-05-26T10:40:00Z'),
        visibility: 'team',
        sourceMetadata: {
          action: 'upload',
          document_title: 'Acme Renewal Plan',
          document_id: 'doc-acme-renewal',
          document_version_id: 'doc-version-1',
          folder_id: 'folder-customers',
          integration_provider: 'google_drive',
          integration_external_id: 'drive-file-99',
          sourcePayloadRef: 's3://timeline-test/documents/acme-renewal-plan.pdf',
          source_payload_digest: 'sha256:acme-renewal-plan',
        },
      },
      {
        id: calendarEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'calendar',
        contentText: 'Acme renewal review is scheduled.',
        occurredAt: new Date('2026-05-26T10:45:00Z'),
        visibility: 'team',
        sourceMetadata: {
          calendar_title: 'Acme renewal review',
          action: 'scheduled',
          calendar_event_id: 'calendar-acme-renewal',
          meeting_id: 'meeting-acme-renewal',
          source: 'meeting_bot',
        },
      },
      {
        id: webhookEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'ingest_webhook',
        contentText: 'Customer portal says Acme is red.',
        occurredAt: new Date('2026-05-26T10:50:00Z'),
        visibility: 'team',
        sourceMetadata: {
          ingest_webhook_name: 'Customer Portal',
          ingest_webhook_id: 'webhook-customer-portal',
          ingest_webhook_dedup_key: 'portal:acme:2026-05-26',
          ingest_webhook_body_sha256: 'sha256-acme-portal',
          source_url: 'https://portal.example/customers/acme',
        },
      },
      {
        id: systemEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'system',
        contentText: 'Board item moved Acme renewal to Blocked.',
        occurredAt: new Date('2026-05-26T10:55:00Z'),
        visibility: 'team',
        sourceMetadata: {
          system_event_kind: 'board_item_update',
          entity_id: 'entity-acme-renewal',
          relationship_id: 'relationship-acme-owner',
          note_id: 'note-acme-risk',
          identity_facet_id: 'identity-acme-domain',
          source_payload_ref: 'inline://timeline/system/board_item_update/system-event',
        },
      },
    ]);

    const webPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: webEventId },
      'event',
    );
    const meetingPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: meetingEventId },
      'event',
    );
    const documentPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: documentEventId },
      'event',
    );
    const calendarPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: calendarEventId },
      'event',
    );
    const webhookPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: webhookEventId },
      'event',
    );
    const systemPlan = await buildEmbeddingPlan(
      db as never,
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: systemEventId },
      'event',
    );

    expect(webPlan?.text).toContain('Source context: Web | event manual_note');
    expect(webPlan?.text).toContain('object web-note-acme-renewal');
    expect(webPlan?.text).toContain('url https://timeline.example/events/web-note-acme-renewal');
    expect(meetingPlan?.text).toContain('Source context: Meeting | title Acme Renewal Review');
    expect(meetingPlan?.text).toContain('speakers Ada Lovelace, Grace Hopper');
    expect(meetingPlan?.text).toContain('summary Legal owns the renewal review before launch.');
    expect(meetingPlan?.text).toContain('partial capture true');
    expect(documentPlan?.text).toContain('Source context: Document | action upload');
    expect(documentPlan?.text).toContain('title Acme Renewal Plan');
    expect(documentPlan?.text).toContain('provider google_drive');
    expect(documentPlan?.text).toContain('external object drive-file-99');
    expect(documentPlan?.text).toContain(
      'source ref s3://timeline-test/documents/acme-renewal-plan.pdf',
    );
    expect(documentPlan?.text).toContain('payload digest sha256:acme-renewal-plan');
    expect(calendarPlan?.text).toContain('Source context: Calendar | title Acme renewal review');
    expect(calendarPlan?.text).toContain('action scheduled');
    expect(calendarPlan?.text).toContain('source meeting_bot');
    expect(webhookPlan?.text).toContain('Source context: Ingest webhook | name Customer Portal');
    expect(webhookPlan?.text).toContain('dedup portal:acme:2026-05-26');
    expect(webhookPlan?.text).toContain('body sha256 sha256-acme-portal');
    expect(systemPlan?.text).toContain('Source context: System | kind board_item_update');
    expect(systemPlan?.text).toContain('object entity-acme-renewal');
    expect(systemPlan?.text).toContain('relationship relationship-acme-owner');
    expect(systemPlan?.text).toContain(
      'source ref inline://timeline/system/board_item_update/system-event',
    );
  });

  it('includes stale object summary text in object embedding narratives', async () => {
    const objectId = '50000000-0000-0000-0000-000000000001';
    await db.insert(entities).values({
      id: objectId,
      teamId: TEAM_ID,
      type: 'company',
      canonicalName: 'DFK',
      status: 'open',
    });
    await db.insert(objectSummaries).values({
      teamId: TEAM_ID,
      entityId: objectId,
      status: 'stale',
      summary: {
        overview: 'DFK has a confirmed June 30 pilot discussion.',
        overviewSourceRefs: [{ kind: 'field', id: 'status' }],
        currentState: [],
        openQuestions: [],
        conflicts: [],
      },
      plainText: 'DFK has a confirmed June 30 pilot discussion.',
      sourceRefs: [{ kind: 'field', id: 'status' }],
      sourceCounts: {
        fields: 1,
        facts: 0,
        events: 0,
        notes: 0,
        relationships: 0,
        tasks: 0,
        changes: 0,
      },
      inputFingerprint: 'old-fingerprint',
      generatedAt: new Date('2026-06-02T10:05:00.000Z'),
      staleAt: new Date('2026-06-02T10:10:00.000Z'),
    });

    const plan = await buildEmbeddingPlan(
      db as never,
      { scope: 'object', teamId: TEAM_ID, objectId },
      'object',
    );

    expect(plan?.text).toContain('summary=DFK has a confirmed June 30 pilot discussion.');
  });

  it('caps long metadata snippets at the requested maximum length', () => {
    const sender = 'A'.repeat(130);
    const rendered = renderRawEventForAi({
      source: 'slack',
      contentText: 'hello',
      sourceMetadata: { slack_sender_name: sender },
    });

    const renderedSender = rendered?.match(/sender ([A.]+)/)?.[1];
    expect(renderedSender).toBe(`${'A'.repeat(117)}...`);
    expect(renderedSender).toHaveLength(120);
  });

  it('embeds private document chunks with visibility payloads for retrieval-time filtering', async () => {
    const documentId = '20000000-0000-0000-0000-000000000001';
    const versionId = '20000000-0000-0000-0000-000000000002';
    const chunkId = '20000000-0000-0000-0000-000000000003';
    await db.insert(documents).values({
      id: documentId,
      teamId: TEAM_ID,
      name: 'Private doc',
      ownerUserId: USER_ID,
      visibility: 'private',
      metadata: {},
    });
    await db.insert(documentVersions).values({
      id: versionId,
      teamId: TEAM_ID,
      documentId,
      version: 1,
      objectKey: 'team/doc/v1',
      uploadedByUserId: USER_ID,
      processingStatus: 'chunked',
    });
    await db.insert(documentChunks).values({
      id: chunkId,
      teamId: TEAM_ID,
      documentId,
      documentVersionId: versionId,
      chunkIndex: 0,
      text: 'private chunk',
      tokenCount: 2,
    });

    const plan = await buildEmbeddingPlan(
      db as never,
      { scope: 'doc_chunk', teamId: TEAM_ID, documentChunkId: chunkId },
      'doc_chunk',
    );
    expect(plan).toMatchObject({
      sourceKind: 'doc_chunk',
      scope: 'doc_chunk',
      text: 'private chunk',
      payloadOverrides: {
        visibility: 'private',
        visibility_owner_user_id: USER_ID,
        file_kind: 'document',
        representation_kind: 'source_text',
      },
    });
  });

  it('skips meeting chunks unless the meeting is team-visible', async () => {
    const meetingId = '30000000-0000-0000-0000-000000000001';
    const chunkId = '30000000-0000-0000-0000-000000000002';
    await db.insert(meetings).values({
      id: meetingId,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      defaultVisibility: 'specific_users',
      visibilityUserIds: [USER_ID],
    });
    await db.insert(meetingTranscriptChunks).values({
      id: chunkId,
      meetingId,
      teamId: TEAM_ID,
      speaker: 'Ada',
      text: 'restricted transcript',
      startMs: 0,
      endMs: 1000,
    });

    await expect(
      buildEmbeddingPlan(
        db as never,
        { scope: 'meeting_chunk', teamId: TEAM_ID, meetingChunkId: chunkId },
        'meeting_chunk',
      ),
    ).resolves.toBeNull();
  });

  it('skips calendar events unless the event is team-visible', async () => {
    const calendarEventId = '40000000-0000-0000-0000-000000000001';
    await db.insert(calendarEvents).values({
      id: calendarEventId,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Private appointment',
      startAt: new Date('2026-05-26T11:00:00Z'),
      endAt: new Date('2026-05-26T12:00:00Z'),
      timezone: 'UTC',
      visibility: 'private',
      metadata: {},
    });

    await expect(
      buildEmbeddingPlan(
        db as never,
        { scope: 'calendar_event', teamId: TEAM_ID, calendarEventId },
        'calendar_event',
      ),
    ).resolves.toBeNull();
  });
});
