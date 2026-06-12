import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  calendarEvents,
  documentChunks,
  documents,
  documentVersions,
  meetings,
  meetingTranscriptChunks,
  rawEvents,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderRawEventForAi } from '#src/embedding/raw-event-renderer.js';
import { buildEmbeddingPlan } from '#src/embedding/sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) await pg.exec(stmt);
  }
}

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
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
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
