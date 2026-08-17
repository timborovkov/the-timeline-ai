import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';
import { getDb, getDbClient } from '@timeline/db';
import { closeEmbedQueue, getEmbedQueue } from '@timeline/shared/queue';
import { withTeam } from '@timeline/shared/team-scope';
import { handleUpdate, type TelegramApi } from '@timeline/shared/telegram';

import { processEmbedJobForTests } from '../apps/worker/src/workers/embed.js';
import { processSuggestionJobForTests } from '../apps/worker/src/workers/suggestions.js';
import { processTranscribeJobForTests } from '../apps/worker/src/workers/transcribe.js';
import { newSignedInPage, signIn, signInFromCurrentPage, waitForPost } from './helpers.js';
import { E2E_PREFIX, e2eOtherTeam, e2eSeedEvents, e2eTeam, e2eUsers } from './test-data.js';

/**
 * Core product E2E coverage. These tests intentionally cross the real browser,
 * auth, server-action, DB, and RSC boundaries for the workflows that define
 * Timeline's day-one trust: sign-in, team isolation, capture visibility,
 * objects, notes, archive state, saved boards, calendar, and documents.
 */

function literalPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function referenceButtonPattern(kind: 'ent' | 'ev'): RegExp {
  return new RegExp(`Open reference \\[${kind}:`);
}

async function uploadTextDocument(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  let documentPostCount = 0;
  const finalized = page.waitForResponse((res) => {
    if (!res.url().includes('/app/documents') || res.request().method() !== 'POST') return false;
    documentPostCount += 1;
    return documentPostCount === 2;
  });
  await page.getByRole('button', { name: /^Upload$/ }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await finalized;
  await page.reload();
  await expect(page.getByRole('link', { name: literalPattern(name) })).toBeVisible();
}

async function openHomeCapture(page: Page) {
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Capture a moment' });
  await expect(dialog).toBeVisible();
  const capture = dialog;
  await expect(capture.locator('form[data-capture-ready="true"]')).toBeVisible();
  return capture;
}

async function createMemberInvite(page: Page, email: string): Promise<string> {
  await page.getByPlaceholder('teammate@example.com').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption('member');
  await page.getByRole('button', { name: 'Create invite' }).click();
  const inviteRow = page.locator('li').filter({ hasText: email }).last();
  await expect(inviteRow).toBeVisible();
  const inviteCode = inviteRow.locator('code', { hasText: '/accept-invite/' });
  await expect(inviteCode).toBeVisible();
  return (await inviteCode.innerText()).trim();
}

function invitePath(inviteUrl: string): string {
  return new URL(inviteUrl).pathname;
}

function teamMemberRow(page: Page, email: string) {
  return page.locator('li').filter({ hasText: email }).first();
}

async function waitForOnboardingPatch(page: Page, action: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse(
    (res) =>
      res.url().includes('/api/onboarding/checklist') &&
      res.request().method() === 'PATCH' &&
      res.ok(),
  );
  await action();
  await response;
}

async function waitForSupportRequestByMessage(message: string): Promise<{
  context: Record<string, unknown>;
  currentPage: string | null;
  email: string;
  name: string;
  requestType: string;
  teamId: string | null;
  userId: string | null;
}> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<
      {
        context: Record<string, unknown>;
        currentPage: string | null;
        email: string;
        name: string;
        requestType: string;
        teamId: string | null;
        userId: string | null;
      }[]
    >`
      SELECT
        context,
        current_page AS "currentPage",
        email,
        name,
        request_type AS "requestType",
        team_id AS "teamId",
        user_id AS "userId"
      FROM support_requests
      WHERE message = ${message}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Support request not found for "${message}"`);
}

async function waitForLatestTeamExport(input: {
  requestedByUserId: string;
  teamId: string;
}): Promise<{ error: string | null; id: string; objectKey: string | null; status: string }> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<
      { error: string | null; id: string; objectKey: string | null; status: string }[]
    >`
      SELECT id, object_key AS "objectKey", status, error
      FROM team_exports
      WHERE team_id = ${input.teamId}
        AND requested_by_user_id = ${input.requestedByUserId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Team export row not found');
}

async function createObjectFromUi(page: Page, name: string): Promise<string> {
  await page.goto('/app/objects/new');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create object' }).click();
  await expect(page).toHaveURL(/\/app\/objects\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const objectId = page.url().match(/\/app\/objects\/([0-9a-f-]+)/)?.[1];
  if (!objectId) throw new Error(`Object id not found in ${page.url()}`);
  return objectId;
}

async function seedReadyTeamExport(input: {
  exportId: string;
  objectKey: string;
  requestedByUserId: string;
  teamId: string;
}): Promise<void> {
  const sql = getDbClient();
  await sql`
    INSERT INTO team_exports (
      id,
      team_id,
      requested_by_user_id,
      status,
      object_key,
      manifest,
      omissions,
      completed_at,
      expires_at
    )
    VALUES (
      ${input.exportId},
      ${input.teamId},
      ${input.requestedByUserId},
      'ready',
      ${input.objectKey},
      ${JSON.stringify({ expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })}::jsonb,
      '{}'::jsonb,
      NOW(),
      NOW() + INTERVAL '1 hour'
    )
  `;
}

async function processCapturedSuggestion(text: string): Promise<string> {
  const db = getDb();
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  let rawEventId: string | undefined;
  while (Date.now() < deadline) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM raw_events
      WHERE team_id = ${e2eTeam.id}
        AND content_text = ${text}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    rawEventId = rows[0]?.id;
    if (rawEventId) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!rawEventId) throw new Error(`Captured raw event not found for "${text}"`);

  await processSuggestionJobForTests(
    { db },
    { rawEventId, teamId: e2eTeam.id },
    {
      getEnv: () => ({ OPENROUTER_API_KEY: 'e2e-test-key' }) as never,
      chatStructured: async () => ({ object: { bundles: [] }, model: 'e2e' }) as never,
      modelId: 'e2e-suggestion-model',
    },
  );
  return rawEventId;
}

async function processObjectUpdateSuggestion(input: {
  text: string;
  targetId: string;
  title: string;
  proposedPayload: Record<string, unknown>;
}): Promise<string> {
  const db = getDb();
  const rawEventId = await waitForRawEventIdByText(input.text);
  await processSuggestionJobForTests(
    { db },
    { rawEventId, teamId: e2eTeam.id },
    {
      getEnv: () => ({ OPENROUTER_API_KEY: 'e2e-test-key' }) as never,
      chatStructured: async () =>
        ({
          object: {
            bundles: [
              {
                title: `Object update: ${input.title}`,
                summary: input.text,
                reason: 'The source event describes a change to an existing object.',
                confidence: 'high',
                quote: input.text,
                items: [
                  {
                    operation: 'update',
                    targetKind: 'object',
                    targetId: input.targetId,
                    title: input.title,
                    proposedPayload: input.proposedPayload,
                  },
                ],
              },
            ],
          },
          model: 'e2e-object-update',
        }) as never,
      modelId: 'e2e-object-update-model',
    },
  );
  return rawEventId;
}

async function processTelegramVoiceSuggestion(transcript: string): Promise<string> {
  const db = getDb();
  const sql = getDbClient();
  const tgUserId = Number(String(Date.now()).slice(-9));
  const tgUsername = `${E2E_PREFIX}-telegram-${tgUserId}`;
  const tgRowId = randomUUID();
  await sql`
    INSERT INTO telegram_users (id, tg_user_id, username, user_id)
    VALUES (${tgRowId}, ${tgUserId}, ${tgUsername}, ${e2eUsers.owner.id})
    ON CONFLICT (tg_user_id)
    DO UPDATE SET username = EXCLUDED.username, user_id = EXCLUDED.user_id, updated_at = NOW()
  `;
  await sql`
    INSERT INTO telegram_user_teams (telegram_user_id, team_id, linked_by_user_id, is_active)
    VALUES (${tgRowId}, ${e2eTeam.id}, ${e2eUsers.owner.id}, true)
    ON CONFLICT (telegram_user_id, team_id)
    DO UPDATE SET linked_by_user_id = EXCLUDED.linked_by_user_id, is_active = true
  `;

  const uploaded = new Map<string, Buffer>();
  const transcribeJobs: Array<{ rawEventId: string; teamId: string; audioKey: string }> = [];
  const tg: TelegramApi = {
    sendMessage: () => Promise.resolve(),
    getChatAdministrators: () => Promise.resolve([]),
    answerCallbackQuery: () => Promise.resolve(),
    editMessageText: () => Promise.resolve(),
    getFile: () => Promise.resolve({ file_id: 'e2e-voice-file', file_path: 'voice.ogg' }),
    downloadFile: () => Promise.resolve(Buffer.from('e2e-telegram-voice')),
    setMessageReaction: () => Promise.resolve(),
    sendChatAction: () => Promise.resolve(),
  };

  await handleUpdate(
    {
      db,
      tg,
      audio: {
        async upload(input) {
          uploaded.set(input.key, Buffer.from(input.body));
        },
        async enqueueTranscribe(input) {
          transcribeJobs.push(input);
        },
        buildAudioKey: ({ teamId, chatId, messageId, fileId, extension }) =>
          `teams/${teamId}/telegram/${chatId}/${messageId}-${fileId}.${extension}`,
      },
    },
    {
      update_id: tgUserId,
      message: {
        message_id: tgUserId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgUserId, type: 'private' },
        from: { id: tgUserId, username: tgUsername },
        voice: {
          file_id: 'e2e-voice-file',
          duration: 5,
          mime_type: 'audio/ogg',
          file_size: 18,
        },
      },
    },
  );
  const job = transcribeJobs[0];
  if (!job) throw new Error('Telegram voice did not enqueue a transcribe job');
  const scheduledSuggestionJobs: unknown[] = [];

  await processTranscribeJobForTests({ db }, job, {
    headObject: async () => ({ contentLength: 18 }),
    getObjectBuffer: async () => ({ body: uploaded.get(job.audioKey) ?? Buffer.from('missing') }),
    transcribeAudio: async () => ({ text: transcript, model: 'e2e-whisper' }),
    enqueueExtract: async () => undefined,
    enqueueEmbed: async () => undefined,
    enqueueSuggestion: async (input) => {
      scheduledSuggestionJobs.push(input);
    },
  });
  await processSuggestionJobForTests(
    { db },
    { rawEventId: job.rawEventId, teamId: e2eTeam.id },
    {
      getEnv: () => ({ OPENROUTER_API_KEY: 'e2e-test-key' }) as never,
      chatStructured: async () => ({ object: { bundles: [] }, model: 'e2e' }) as never,
      enqueueSuggestionJob: async (input) => {
        scheduledSuggestionJobs.push(input);
        return undefined as never;
      },
      modelId: 'e2e-telegram-suggestion-model',
    },
  );
  const conversationJob = scheduledSuggestionJobs.find(
    (
      input,
    ): input is { scope: 'conversation_review'; conversationReviewId: string; teamId: string } =>
      Boolean(
        input &&
        typeof input === 'object' &&
        'scope' in input &&
        input.scope === 'conversation_review' &&
        'conversationReviewId' in input &&
        typeof input.conversationReviewId === 'string' &&
        'teamId' in input &&
        typeof input.teamId === 'string',
      ),
  );
  if (!conversationJob) throw new Error('Telegram voice did not schedule a conversation review');
  await sql`
    UPDATE conversation_reviews
    SET quiet_until = NOW() - INTERVAL '1 second'
    WHERE id = ${conversationJob.conversationReviewId}
  `;
  const taskTitle = transcript
    .replace(/^I'll\s+/i, '')
    .replace(/\s+next Monday$/i, '')
    .replace(/^./, (char) => char.toUpperCase());
  await processSuggestionJobForTests({ db }, conversationJob, {
    getEnv: () => ({ OPENROUTER_API_KEY: 'e2e-test-key' }) as never,
    chatStructured: async () =>
      ({
        object: {
          bundles: [
            {
              title: `Commitment: ${taskTitle}`,
              summary: transcript,
              reason: 'A Telegram voice note contains a clear commitment.',
              confidence: 'medium',
              quote: transcript,
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: taskTitle,
                  proposedPayload: {
                    canonicalName: taskTitle,
                    ownerUserId: e2eUsers.owner.id,
                    metadata: { extracted_from_telegram_voice_e2e: true },
                  },
                },
              ],
            },
          ],
        },
        model: 'e2e-telegram-conversation-review',
      }) as never,
    enqueueSuggestionJob: async () => undefined as never,
    modelId: 'e2e-telegram-conversation-review-model',
  });
  return job.rawEventId;
}

async function waitForRawEventIdByText(text: string): Promise<string> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM raw_events
      WHERE content_text = ${text}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows[0]?.id) return rows[0].id;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Raw event not found for "${text}"`);
}

async function countRawEventsByText(text: string): Promise<number> {
  const sql = getDbClient();
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM raw_events
    WHERE team_id = ${e2eTeam.id}
      AND content_text = ${text}
  `;
  return Number(rows[0]?.count ?? '0');
}

async function waitForInboundEmailRawEvent(text: string): Promise<{
  authorUserId: string | null;
  id: string;
  metadata: Record<string, unknown>;
  source: string;
  teamId: string;
  visibility: string;
}> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<
      {
        authorUserId: string | null;
        id: string;
        metadata: Record<string, unknown>;
        source: string;
        teamId: string;
        visibility: string;
      }[]
    >`
      SELECT
        id,
        team_id AS "teamId",
        author_user_id AS "authorUserId",
        source,
        visibility,
        source_metadata AS metadata
      FROM raw_events
      WHERE team_id = ${e2eTeam.id}
        AND content_text = ${text}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Inbound email raw event not found for "${text}"`);
}

async function resetInboundEmailWhitelist(): Promise<void> {
  const sql = getDbClient();
  await sql`
    UPDATE teams
    SET inbound_sender_whitelist_enabled = false,
        inbound_sender_whitelist = '[]'::jsonb
    WHERE id = ${e2eTeam.id}
  `;
}

async function postInboundEmail(
  page: Page,
  input: {
    fromEmail: string;
    fromName?: string;
    messageId: string;
    subject: string;
    text: string;
  },
): Promise<{ inserted: number; ok: boolean }> {
  const fromName = input.fromName ?? input.fromEmail;
  const response = await page.request.post('/api/email/inbound', {
    headers: {
      authorization: `Basic ${Buffer.from('postmark:e2e-postmark-secret').toString('base64')}`,
      'content-type': 'application/json',
    },
    data: {
      MessageID: `postmark-${input.messageId}`,
      Date: new Date().toUTCString(),
      Subject: input.subject,
      From: `${fromName} <${input.fromEmail}>`,
      FromName: fromName,
      FromFull: { Email: input.fromEmail, Name: fromName },
      To: e2eTeam.inboundEmail,
      ToFull: [{ Email: e2eTeam.inboundEmail, Name: e2eTeam.name }],
      OriginalRecipient: e2eTeam.inboundEmail,
      TextBody: input.text,
      Headers: [{ Name: 'Message-ID', Value: `<${input.messageId}@example.test>` }],
      Attachments: [],
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { inserted: number; ok: boolean };
}

interface JobRecoverySeed {
  dismissEventId: string;
  dismissText: string;
  retryEventId: string;
  retryText: string;
}

async function cleanupJobRecoveryE2eSeed(rawEventIds: string[] = []): Promise<void> {
  const sql = getDbClient();
  if (rawEventIds.length > 0) {
    await sql`
      DELETE FROM job_recovery_dismissals
      WHERE team_id = ${e2eTeam.id}
        AND artifact_id = ANY(${rawEventIds}::uuid[])
    `;
  }
  await sql`
    DELETE FROM raw_events
    WHERE team_id = ${e2eTeam.id}
      AND content_text LIKE ${`${E2E_PREFIX} job recovery%`}
  `;
}

async function removeQueuedEmbedJobsForRawEvents(rawEventIds: string[]): Promise<void> {
  if (rawEventIds.length === 0) return;
  const queue = getEmbedQueue();
  try {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'paused', 'prioritized'], 0, 500);
    await Promise.all(
      jobs.map(async (job) => {
        const data = job.data as { rawEventId?: unknown };
        if (typeof data.rawEventId !== 'string' || !rawEventIds.includes(data.rawEventId)) return;
        await job.remove().catch(() => undefined);
      }),
    );
  } finally {
    await closeEmbedQueue();
  }
}

async function seedJobRecoveryDashboardState(stamp: number): Promise<JobRecoverySeed> {
  const sql = getDbClient();
  await cleanupJobRecoveryE2eSeed();
  const retryEventId = randomUUID();
  const dismissEventId = randomUUID();
  const retryText = `${E2E_PREFIX} job recovery retry ${stamp}`;
  const dismissText = `${E2E_PREFIX} job recovery dismiss ${stamp}`;
  const failedAt = new Date(Date.now() - 60_000).toISOString();
  await sql`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_text,
      occurred_at,
      created_at,
      visibility,
      source_metadata
    )
    VALUES
      (
        ${retryEventId},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        'web',
        ${retryText},
        NOW() - INTERVAL '10 minutes',
        NOW() - INTERVAL '10 minutes',
        'team',
        ${JSON.stringify({
          embedding_failed_at: failedAt,
          embedding_error: 'E2E retry embedding failed',
        })}::jsonb
      ),
      (
        ${dismissEventId},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        'web',
        ${dismissText},
        NOW() - INTERVAL '9 minutes',
        NOW() - INTERVAL '9 minutes',
        'team',
        ${JSON.stringify({
          embedding_failed_at: failedAt,
          embedding_error: 'E2E dismiss embedding failed',
        })}::jsonb
      )
  `;
  return { dismissEventId, dismissText, retryEventId, retryText };
}

async function rawEventMetadataHasKey(rawEventId: string, key: string): Promise<boolean> {
  const sql = getDbClient();
  const rows = await sql<{ hasKey: boolean }[]>`
    SELECT source_metadata ? ${key} AS "hasKey"
    FROM raw_events
    WHERE team_id = ${e2eTeam.id}
      AND id = ${rawEventId}
    LIMIT 1
  `;
  return rows[0]?.hasKey ?? false;
}

async function jobRecoveryDismissalExists(rawEventId: string): Promise<boolean> {
  const sql = getDbClient();
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM job_recovery_dismissals
    WHERE team_id = ${e2eTeam.id}
      AND job_kind = 'embedding'
      AND artifact_kind = 'raw_event'
      AND artifact_id = ${rawEventId}
  `;
  return Number(rows[0]?.count ?? '0') > 0;
}

async function cleanupMeetingE2eSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM meeting_usage
    WHERE meeting_id IN (
      SELECT id
      FROM meetings
      WHERE team_id = ${e2eTeam.id}
        AND (
          title LIKE ${`${E2E_PREFIX} meeting%`}
          OR metadata ->> 'e2e' = 'meeting-browser'
        )
    )
  `;
  await sql`
    DELETE FROM raw_events
    WHERE team_id = ${e2eTeam.id}
      AND (
        content_text LIKE ${`${E2E_PREFIX} finalized meeting%`}
        OR source_metadata ->> 'e2e' = 'meeting-browser'
      )
  `;
  await sql`
    DELETE FROM calendar_events
    WHERE team_id = ${e2eTeam.id}
      AND (
        metadata ->> 'e2e' = 'meeting-browser'
        OR metadata ->> 'saved_meeting_id' IN (
          SELECT id::text
          FROM saved_meetings
          WHERE team_id = ${e2eTeam.id}
            AND title LIKE ${`${E2E_PREFIX} meeting%`}
        )
      )
  `;
  await sql`
    DELETE FROM meeting_transcript_chunks
    WHERE meeting_id IN (
      SELECT id
      FROM meetings
      WHERE team_id = ${e2eTeam.id}
        AND (
          title LIKE ${`${E2E_PREFIX} meeting%`}
          OR metadata ->> 'e2e' = 'meeting-browser'
        )
    )
  `;
  await sql`
    DELETE FROM meetings
    WHERE team_id = ${e2eTeam.id}
      AND (
        title LIKE ${`${E2E_PREFIX} meeting%`}
        OR metadata ->> 'e2e' = 'meeting-browser'
      )
  `;
  await sql`
    DELETE FROM saved_meeting_aliases
    WHERE team_id = ${e2eTeam.id}
      AND saved_meeting_id IN (
        SELECT id
        FROM saved_meetings
        WHERE team_id = ${e2eTeam.id}
          AND title LIKE ${`${E2E_PREFIX} meeting%`}
      )
  `;
  await sql`
    DELETE FROM saved_meetings
    WHERE team_id = ${e2eTeam.id}
      AND title LIKE ${`${E2E_PREFIX} meeting%`}
  `;
}

async function waitForSavedMeetingIdByTitle(title: string): Promise<string> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM saved_meetings
      WHERE team_id = ${e2eTeam.id}
        AND title = ${title}
        AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows[0]?.id) return rows[0].id;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Saved meeting not found for "${title}"`);
}

async function seedFinalizedMeetingCapture(input: {
  rawEventText: string;
  savedMeetingId: string;
  summary: string;
  title: string;
}): Promise<string> {
  const sql = getDbClient();
  const meetingId = randomUUID();
  const rawEventId = randomUUID();
  const firstChunkId = randomUUID();
  const secondChunkId = randomUUID();
  await sql`
    INSERT INTO meetings (
      id,
      team_id,
      created_by_user_id,
      saved_meeting_id,
      provider,
      provider_bot_id,
      platform,
      meeting_url,
      title,
      status,
      default_visibility,
      participants,
      metadata,
      started_at,
      ended_at,
      created_at,
      updated_at
    )
    VALUES (
      ${meetingId},
      ${e2eTeam.id},
      ${e2eUsers.owner.id},
      ${input.savedMeetingId},
      'recall',
      ${`e2e-bot-${meetingId}`},
      'meet',
      'https://meet.google.com/e2e-meet-final',
      ${input.title},
      'completed',
      'team',
      ${JSON.stringify([{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }])}::jsonb,
      ${JSON.stringify({
        e2e: 'meeting-browser',
        summary: input.summary,
        summary_model: 'e2e-meeting-summary',
        action_items: [{ text: 'Send Acme launch checklist', owner: 'Ada Lovelace' }],
      })}::jsonb,
      NOW() - INTERVAL '35 minutes',
      NOW() - INTERVAL '5 minutes',
      NOW() - INTERVAL '35 minutes',
      NOW() - INTERVAL '5 minutes'
    )
  `;
  await sql`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_text,
      occurred_at,
      created_at,
      visibility,
      source_metadata
    )
    VALUES (
      ${rawEventId},
      ${e2eTeam.id},
      ${e2eUsers.owner.id},
      'meeting',
      ${input.rawEventText},
      NOW() - INTERVAL '5 minutes',
      NOW() - INTERVAL '5 minutes',
      'team',
      ${JSON.stringify({
        e2e: 'meeting-browser',
        meeting_id: meetingId,
        meeting_chunk_provider_id: `meeting-finalized:${meetingId}`,
        source: 'meeting_bot',
        summary: input.summary,
        action_items: [{ text: 'Send Acme launch checklist', owner: 'Ada Lovelace' }],
      })}::jsonb
    )
  `;
  await sql`
    INSERT INTO meeting_transcript_chunks (
      id,
      meeting_id,
      team_id,
      speaker,
      text,
      start_ms,
      end_ms,
      raw_event_id,
      provider_chunk_id
    )
    VALUES
      (
        ${firstChunkId},
        ${meetingId},
        ${e2eTeam.id},
        'Ada Lovelace',
        'Acme confirmed the launch checklist needs to go out today.',
        62000,
        68000,
        ${rawEventId},
        'e2e-meeting-chunk-1'
      ),
      (
        ${secondChunkId},
        ${meetingId},
        ${e2eTeam.id},
        'Grace Hopper',
        'Decision: keep onboarding scope unchanged and ship the checklist.',
        121000,
        128000,
        ${rawEventId},
        'e2e-meeting-chunk-2'
      )
  `;
  await sql`
    INSERT INTO meeting_usage (team_id, meeting_id, minutes)
    VALUES (${e2eTeam.id}, ${meetingId}, 30)
    ON CONFLICT (meeting_id) DO NOTHING
  `;
  return meetingId;
}

async function countObjectsByName(name: string): Promise<number> {
  const sql = getDbClient();
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM entities
    WHERE team_id = ${e2eTeam.id}
      AND canonical_name = ${name}
      AND merged_into_id IS NULL
  `;
  return Number(rows[0]?.count ?? '0');
}

test('seeded owner can sign in, switch teams, and sign out', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(
    page.getByPlaceholder('Ask what changed, what is blocked, or what needs attention…'),
  ).toBeVisible();

  await page.getByRole('button', { name: new RegExp(`Switch team.*${e2eTeam.name}`) }).click();
  await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(e2eOtherTeam.name) }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByText(`team · ${e2eOtherTeam.name}`)).toBeVisible();
  await page.keyboard.press('Escape');

  const accountButton = page.getByRole('button', { name: 'Account' });
  const signOutItem = page.getByRole('menuitem', { name: 'Sign out' });
  await accountButton.click();
  await expect(signOutItem)
    .toBeVisible({ timeout: 2_000 })
    .catch(async () => {
      await accountButton.click();
      await expect(signOutItem).toBeVisible();
    });
  await signOutItem.click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('mobile navigation keeps the team switcher visible, closable, and actionable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, e2eUsers.owner.email);
  await page.goto('/app');

  await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigationDialog = page.getByRole('dialog', { name: 'Navigation' });
  await expect(navigationDialog).toBeVisible();

  const teamSwitcher = page.getByRole('button', {
    name: new RegExp(`Switch team.*${e2eTeam.name}`),
  });
  await teamSwitcher.click();
  const teamsDialog = page.getByRole('dialog', { name: 'Teams' });
  await expect(teamsDialog).toBeVisible();
  await expect(
    teamsDialog.getByRole('button', { name: new RegExp(e2eOtherTeam.name) }),
  ).toBeVisible();

  await teamsDialog.getByRole('button', { name: 'Close' }).click();
  await expect(teamsDialog).toBeHidden();
  await expect(navigationDialog).toBeVisible();

  await teamSwitcher.click();
  await expect(teamsDialog).toBeVisible();
  await waitForPost(page, `/app/team/switch/${e2eOtherTeam.id}`, () =>
    teamsDialog.getByRole('button', { name: new RegExp(e2eOtherTeam.name) }).click(),
  );
});

test('task categories and primary project stay distinct and filter together', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const sql = getDbClient();
  const stamp = Date.now();
  const projectName = `Faba website redesign ${stamp}`;
  const taskName = `Prepare homepage wireframes ${stamp}`;
  let projectId: string | null = null;
  let taskId: string | null = null;
  try {
    await ownerPage.goto('/app/objects/new');
    await ownerPage.getByLabel('Type').selectOption('project');
    await ownerPage.getByLabel('Name').fill(projectName);
    await ownerPage.getByRole('button', { name: 'Create object' }).click();
    await expect(ownerPage).toHaveURL(/\/app\/objects\/[0-9a-f-]+/);
    projectId = ownerPage.url().match(/\/app\/objects\/([0-9a-f-]+)/)?.[1] ?? null;
    if (!projectId) throw new Error('created project id missing');

    await ownerPage.getByRole('link', { name: 'Add task' }).click();
    await expect(ownerPage.getByLabel('Task project', { exact: true })).toHaveValue(projectId);
    await ownerPage.getByLabel('Name').fill(taskName);
    await ownerPage.getByRole('button', { name: 'Create object' }).click();
    await expect(ownerPage).toHaveURL(new RegExp(`/app/objects/${projectId}$`));
    await expect(ownerPage.getByText(taskName).first()).toBeVisible();

    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM entities
      WHERE team_id = ${e2eTeam.id}
        AND type = 'task'
        AND canonical_name = ${taskName}
      LIMIT 1
    `;
    taskId = rows[0]?.id ?? null;
    if (!taskId) throw new Error('created task id missing');
    const relations = await sql<{ projectId: string }[]>`
      SELECT to_entity_id AS "projectId"
      FROM entity_relationships
      WHERE team_id = ${e2eTeam.id}
        AND from_entity_id = ${taskId}
        AND kind = 'child'
    `;
    expect(relations).toEqual([{ projectId }]);

    await ownerPage.goto(`/app/objects/${taskId}`);
    await expect(ownerPage.getByText('Categorizing…').first()).toBeVisible();
    await ownerPage.getByLabel('Task category').selectOption('design');
    await expect(ownerPage.getByLabel('Task category')).toHaveValue('design');
    await expect(ownerPage.getByLabel('Task project', { exact: true })).toHaveValue(projectId);

    await ownerPage.goto(`/app/tasks?category=design&project=${projectId}&view=list`);
    await expect(ownerPage.getByText(taskName).first()).toBeVisible();
    await expect(ownerPage.getByText('Design').first()).toBeVisible();

    await ownerPage.goto(`/app/objects/${taskId}`);
    await ownerPage.getByLabel('Task project', { exact: true }).selectOption('');
    await expect(ownerPage.getByLabel('Task project', { exact: true })).toHaveValue('');
    await expect(ownerPage.getByLabel('Task category')).toHaveValue('design');
    await expect(
      sql`SELECT 1 FROM entity_relationships WHERE from_entity_id = ${taskId}`,
    ).resolves.toHaveLength(0);

    await ownerPage.getByLabel('Task category').selectOption('__automatic__');
    const firstPendingHash = await expect
      .poll(async () => {
        const [row] = await sql<{ requestedHash: string | null }[]>`
          SELECT task_category_requested_input_hash AS "requestedHash"
          FROM entities WHERE id = ${taskId}
        `;
        return row?.requestedHash ?? null;
      })
      .not.toBeNull()
      .then(async () => {
        const [row] = await sql<{ requestedHash: string }[]>`
          SELECT task_category_requested_input_hash AS "requestedHash"
          FROM entities WHERE id = ${taskId}
        `;
        return row?.requestedHash;
      });
    await ownerPage.getByLabel('Task project', { exact: true }).selectOption(projectId);
    await expect
      .poll(async () => {
        const [row] = await sql<{ requestedHash: string | null }[]>`
          SELECT task_category_requested_input_hash AS "requestedHash"
          FROM entities WHERE id = ${taskId}
        `;
        return row?.requestedHash ?? null;
      })
      .not.toBe(firstPendingHash);

    await sql`
      UPDATE entities
      SET task_category_status = 'failed', task_category_requested_input_hash = NULL
      WHERE id = ${taskId}
    `;
    await ownerPage.reload();
    await ownerPage.getByRole('button', { name: 'Retry automatic category' }).click();
    await expect
      .poll(async () => {
        const [row] = await sql<{ status: string }[]>`
          SELECT task_category_status AS status FROM entities WHERE id = ${taskId}
        `;
        return row?.status;
      })
      .toBe('pending');
  } finally {
    await ownerPage.goto('about:blank');
    if (taskId) await sql`DELETE FROM entities WHERE team_id = ${e2eTeam.id} AND id = ${taskId}`;
    if (projectId)
      await sql`DELETE FROM entities WHERE team_id = ${e2eTeam.id} AND id = ${projectId}`;
    await ownerPage.context().close();
  }
});

test('onboarding checklist supports manual completion, dismissal, and reopening', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');

  await ownerPage.goto('/app');
  await expect(ownerPage.getByText('Next setup step')).toBeVisible();
  const markNextStep = ownerPage.getByRole('button', { name: /^Mark .+ complete$/ });
  await expect(markNextStep).toBeVisible();
  const completedStepLabel = await markNextStep.getAttribute('aria-label');
  if (!completedStepLabel) throw new Error('next setup step is missing an accessible label');

  await waitForOnboardingPatch(ownerPage, async () => {
    await markNextStep.click();
  });
  await expect(ownerPage.getByRole('button', { name: completedStepLabel })).toHaveCount(0);

  await waitForOnboardingPatch(ownerPage, async () => {
    await ownerPage.getByRole('button', { name: 'Dismiss setup' }).click();
  });
  await expect(ownerPage.getByRole('button', { name: 'Reopen setup' })).toBeVisible();

  await ownerPage.reload();
  await expect(ownerPage.getByRole('button', { name: 'Reopen setup' })).toBeVisible();

  await waitForOnboardingPatch(ownerPage, async () => {
    await ownerPage.getByRole('button', { name: 'Reopen setup' }).click();
  });
  await expect(ownerPage.getByText('Next setup step')).toBeVisible();
});

test('timeline capture enforces team, private, specific-user, and cross-team visibility', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const teamNote = `E2E team note ${Date.now()}`;

  await ownerPage.goto('/app');
  const capture = await openHomeCapture(ownerPage);
  await capture.getByPlaceholder('What happened?').fill(teamNote);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(teamNote).first()).toBeVisible();

  await ownerPage.goto('/app/timeline');
  await expect(ownerPage.getByText(e2eSeedEvents.privateForOwner).first()).toBeVisible();

  const memberPage = await newSignedInPage(browser, 'member');
  await memberPage.goto('/app/timeline');
  await expect(memberPage.getByText(teamNote).first()).toBeVisible();
  await expect(memberPage.getByText(e2eSeedEvents.privateForOwner)).toHaveCount(0);
  await expect(memberPage.getByText(e2eSeedEvents.specificForMember).first()).toBeVisible();

  const nonMemberPage = await newSignedInPage(browser, 'nonMember');
  await nonMemberPage.goto('/app/timeline');
  await expect(nonMemberPage.getByText(e2eSeedEvents.otherTeam).first()).toBeVisible();
  await expect(nonMemberPage.getByText(teamNote)).toHaveCount(0);
  await expect(nonMemberPage.getByText(e2eSeedEvents.privateForOwner)).toHaveCount(0);

  await ownerPage.context().close();
  await memberPage.context().close();
  await nonMemberPage.context().close();
});

test('timeline filters source, author, and dates without leaving audit-trail mode', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const db = getDb();
  const sql = getDbClient();
  const stamp = String(Date.now());
  const targetText = `${E2E_PREFIX} timeline filter email owner ${stamp}`;
  const sourceMismatchText = `${E2E_PREFIX} timeline filter web member ${stamp}`;
  const dateMismatchText = `${E2E_PREFIX} timeline filter old email owner ${stamp}`;

  try {
    const ownerScope = withTeam(db, e2eTeam.id, e2eUsers.owner.id).timeline;
    const memberScope = withTeam(db, e2eTeam.id, e2eUsers.member.id).timeline;
    await ownerScope.createEvent({
      authorUserId: e2eUsers.owner.id,
      source: 'email',
      contentText: targetText,
      occurredAt: new Date('2026-09-10T12:00:00.000Z'),
      visibility: 'team',
      sourceMetadata: { e2e: 'timeline-filter', stamp, subject: 'E2E filtered email' },
    });
    await memberScope.createEvent({
      authorUserId: e2eUsers.member.id,
      source: 'web',
      contentText: sourceMismatchText,
      occurredAt: new Date('2026-09-10T13:00:00.000Z'),
      visibility: 'team',
      sourceMetadata: { e2e: 'timeline-filter', stamp },
    });
    await ownerScope.createEvent({
      authorUserId: e2eUsers.owner.id,
      source: 'email',
      contentText: dateMismatchText,
      occurredAt: new Date('2026-09-09T12:00:00.000Z'),
      visibility: 'team',
      sourceMetadata: { e2e: 'timeline-filter', stamp, subject: 'E2E old filtered email' },
    });

    await ownerPage.goto('/app/timeline?mode=events');
    await expect(ownerPage.getByText(targetText).first()).toBeVisible();
    await expect(ownerPage.getByText(sourceMismatchText).first()).toBeVisible();

    await ownerPage
      .locator('summary')
      .filter({ hasText: /^Filters$/ })
      .click();
    await ownerPage.getByRole('button', { name: 'Source', exact: true }).click();
    await ownerPage.getByRole('menuitemcheckbox', { name: 'Email' }).click();
    await ownerPage.keyboard.press('Escape');
    await ownerPage.getByRole('button', { name: 'Author', exact: true }).click();
    await ownerPage.getByRole('menuitemcheckbox', { name: e2eUsers.owner.name }).click();
    await ownerPage.keyboard.press('Escape');
    await ownerPage.locator('input[name="from"]').fill('2026-09-10');
    await ownerPage.locator('input[name="to"]').fill('2026-09-10');

    await expect(ownerPage).toHaveURL(/mode=events/);
    await expect(ownerPage).toHaveURL(/source=email/);
    await expect(ownerPage).toHaveURL(new RegExp(`author=${e2eUsers.owner.id}`));
    await expect(ownerPage).toHaveURL(/from=2026-09-10/);
    await expect(ownerPage).toHaveURL(/to=2026-09-10/);
    await expect(ownerPage.getByText(targetText).first()).toBeVisible();
    await expect(ownerPage.getByText(sourceMismatchText)).toHaveCount(0);
    await expect(ownerPage.getByText(dateMismatchText)).toHaveCount(0);
    await expect(ownerPage.getByText('Filters · On')).toBeVisible();

    await ownerPage.getByRole('link', { name: 'Clear' }).click();
    await expect(ownerPage).toHaveURL(/\/app\/timeline\?mode=events$/);
    await expect(ownerPage.getByText(targetText).first()).toBeVisible();
    await expect(ownerPage.getByText(sourceMismatchText).first()).toBeVisible();
  } finally {
    await sql`
      DELETE FROM raw_events
      WHERE team_id = ${e2eTeam.id}
        AND source_metadata ->> 'e2e' = 'timeline-filter'
        AND source_metadata ->> 'stamp' = ${stamp}
    `;
    await ownerPage.context().close();
  }
});

test('timeline inspector edits visibility and removes conversational events', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const db = getDb();
  const sql = getDbClient();
  const stamp = String(Date.now());
  const eventText = `${E2E_PREFIX} timeline lifecycle slack ${stamp}`;
  let rawEventId: string | null = null;

  try {
    const scope = withTeam(db, e2eTeam.id, e2eUsers.owner.id).timeline;
    const rawEvent = await scope.createEvent({
      authorUserId: e2eUsers.owner.id,
      source: 'slack',
      contentText: eventText,
      occurredAt: new Date('2026-09-11T12:00:00.000Z'),
      visibility: 'team',
      visibilityOwnerUserId: e2eUsers.owner.id,
      sourceMetadata: {
        e2e: 'timeline-lifecycle',
        stamp,
        slack_workspace_id: `T-E2E-${stamp}`,
        slack_channel_id: `C-E2E-${stamp}`,
        slack_channel_name: 'e2e-lifecycle',
        slack_message_ts: `${stamp}.000100`,
        slack_sender_name: e2eUsers.owner.name,
      },
    });
    rawEventId = rawEvent.id;

    await ownerPage.goto(`/app/timeline?mode=events&event=${rawEvent.id}`);
    const inspector = ownerPage.locator('#inspector-pane');
    await expect(inspector).toBeVisible();
    await expect(ownerPage.getByText(eventText).first()).toBeVisible();

    await inspector
      .locator('summary')
      .filter({ hasText: /^Team visibility$/ })
      .click();
    await inspector.getByLabel('Who can see this evidence?').selectOption('private');
    await inspector.getByRole('button', { name: 'Save visibility' }).click();
    await expect(inspector.getByRole('status')).toHaveText('Visibility saved');
    await expect
      .poll(async () => {
        const rows = await sql<{ visibility: string }[]>`
          SELECT visibility
          FROM raw_events
          WHERE id = ${rawEvent.id}
            AND team_id = ${e2eTeam.id}
          LIMIT 1
        `;
        return rows[0]?.visibility ?? null;
      })
      .toBe('private');

    await inspector.getByRole('button', { name: /Actions for Slack evidence/ }).click();
    await ownerPage.getByRole('menuitem', { name: 'Remove evidence' }).click();
    await expect(
      ownerPage.getByText(
        /tombstone this captured Telegram or Slack message and all stored revisions/i,
      ),
    ).toBeVisible();
    await waitForPost(ownerPage, '/app/timeline', () =>
      ownerPage.getByRole('button', { name: 'Remove evidence' }).click(),
    );
    await expect(inspector).toBeHidden();
    await expect(ownerPage.getByText('Evidence removed from Timeline')).toBeVisible();
    await expect
      .poll(async () => {
        const rows = await sql<{ deleted: boolean }[]>`
          SELECT source_metadata ->> 'deleted' = 'true' AS deleted
          FROM raw_events
          WHERE id = ${rawEvent.id}
            AND team_id = ${e2eTeam.id}
          LIMIT 1
        `;
        return rows[0]?.deleted ?? false;
      })
      .toBe(true);

    await ownerPage.goto('/app/timeline?mode=events');
    await expect(ownerPage.getByText(eventText)).toHaveCount(0);
  } finally {
    await sql`
      DELETE FROM raw_events
      WHERE team_id = ${e2eTeam.id}
        AND source_metadata ->> 'e2e' = 'timeline-lifecycle'
        AND source_metadata ->> 'stamp' = ${stamp}
    `;
    if (rawEventId) {
      await sql`
        DELETE FROM raw_events
        WHERE team_id = ${e2eTeam.id}
          AND id = ${rawEventId}
      `;
    }
    await ownerPage.context().close();
  }
});

test('Postmark inbound email lands as a cited team timeline event', async ({ page }) => {
  const stamp = Date.now();
  const emailText = `E2E inbound email customer renewal note ${stamp}`;
  const messageId = `timeline-e2e-inbound-${stamp}`;

  await expect(
    postInboundEmail(page, {
      fromEmail: e2eUsers.owner.email,
      fromName: e2eUsers.owner.name,
      messageId,
      subject: `E2E customer renewal ${stamp}`,
      text: emailText,
    }),
  ).resolves.toEqual({ ok: true, inserted: 1 });

  const rawEvent = await waitForInboundEmailRawEvent(emailText);
  expect(rawEvent).toMatchObject({
    authorUserId: e2eUsers.owner.id,
    source: 'email',
    teamId: e2eTeam.id,
    visibility: 'team',
  });
  expect(rawEvent.metadata).toMatchObject({
    message_id: `${messageId}@example.test`,
    subject: `E2E customer renewal ${stamp}`,
    thread_root_id: rawEvent.id,
  });

  await signIn(page, e2eUsers.owner.email);
  await page.goto('/app/timeline');
  await expect(page.getByText(emailText).first()).toBeVisible();
});

test('inbound email sender whitelist blocks and allows Postmark capture from the browser', async ({
  page,
}) => {
  const stamp = Date.now();
  const blockedText = `E2E inbound whitelist blocked note ${stamp}`;
  const allowedText = `E2E inbound whitelist allowed note ${stamp}`;
  const allowedSender = `allowed-${stamp}@example.test`;

  await resetInboundEmailWhitelist();
  try {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team?section=email');

    const whitelistForm = page.locator('form').filter({ hasText: 'Allowed senders' });
    await expect(whitelistForm).toBeVisible();
    await whitelistForm.getByRole('checkbox', { name: 'Enable sender whitelist' }).check();
    await whitelistForm.getByLabel('Allowed senders').fill(allowedSender);
    await waitForPost(page, '/app/team', async () => {
      await whitelistForm.getByRole('button', { name: 'Save email settings' }).click();
    });
    await expect(whitelistForm.getByText('Email settings updated.')).toBeVisible();

    await expect(
      postInboundEmail(page, {
        fromEmail: `blocked-${stamp}@example.test`,
        messageId: `timeline-e2e-inbound-blocked-${stamp}`,
        subject: `E2E blocked sender ${stamp}`,
        text: blockedText,
      }),
    ).resolves.toEqual({ ok: false, inserted: 0 });
    await expect.poll(() => countRawEventsByText(blockedText)).toBe(0);

    await expect(
      postInboundEmail(page, {
        fromEmail: allowedSender.toUpperCase(),
        messageId: `timeline-e2e-inbound-allowed-${stamp}`,
        subject: `E2E allowed sender ${stamp}`,
        text: allowedText,
      }),
    ).resolves.toEqual({ ok: true, inserted: 1 });
    const rawEvent = await waitForInboundEmailRawEvent(allowedText);
    expect(rawEvent).toMatchObject({
      authorUserId: null,
      source: 'email',
      teamId: e2eTeam.id,
      visibility: 'team',
    });
    expect(rawEvent.metadata).toMatchObject({
      sender_unverified: true,
      subject: `E2E allowed sender ${stamp}`,
    });

    await page.goto('/app/timeline');
    await expect(page.getByText(allowedText).first()).toBeVisible();
    await expect(page.getByText(blockedText)).toHaveCount(0);
  } finally {
    await resetInboundEmailWhitelist();
  }
});

test('job recovery dashboard retries and dismisses failed work from the browser', async ({
  page,
}) => {
  const seed = await seedJobRecoveryDashboardState(Date.now());
  const rawEventIds = [seed.retryEventId, seed.dismissEventId];
  try {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/jobs');
    await expect(page.getByRole('heading', { name: 'Processing summary' })).toBeVisible();

    await page.getByRole('button', { name: 'Embedding' }).click();
    const retryRow = page.locator('li').filter({ hasText: 'E2E retry embedding failed' });
    const dismissRow = page.locator('li').filter({ hasText: 'E2E dismiss embedding failed' });
    await expect(retryRow).toBeVisible();
    await expect(dismissRow).toBeVisible();
    await expect(retryRow.getByText('Embedding · web event from')).toBeVisible();

    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/retry') && res.ok()),
      retryRow.getByRole('button', { name: 'Retry' }).click(),
    ]);
    await expect(retryRow.getByText('retrying')).toBeVisible();
    await expect(retryRow.getByText('Retry queued. Watching finished jobs below.')).toBeVisible();
    await expect
      .poll(() => rawEventMetadataHasKey(seed.retryEventId, 'embedding_failed_at'))
      .toBe(false);
    await expect
      .poll(() => rawEventMetadataHasKey(seed.retryEventId, 'embedding_error'))
      .toBe(false);

    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/dismiss') && res.ok()),
      dismissRow.getByRole('button', { name: 'Dismiss' }).click(),
    ]);
    await expect(dismissRow).toHaveCount(0);
    await expect.poll(() => jobRecoveryDismissalExists(seed.dismissEventId)).toBe(true);

    await page.reload();
    await page.getByRole('button', { name: 'Embedding' }).click();
    await expect(page.getByText('E2E retry embedding failed')).toHaveCount(0);
    await expect(page.getByText('E2E dismiss embedding failed')).toHaveCount(0);
  } finally {
    await removeQueuedEmbedJobsForRawEvents(rawEventIds);
    await cleanupJobRecoveryE2eSeed(rawEventIds);
  }
});

test('saved meeting setup and finalized notes render in meetings and timeline', async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `${E2E_PREFIX} meeting customer launch ${stamp}`;
  const alias = `${E2E_PREFIX}-launch-${stamp}`;
  const summary = `Acme confirmed launch readiness and asked for the checklist today ${stamp}.`;
  const rawEventText = `${E2E_PREFIX} finalized meeting ${stamp}\n\nSummary: ${summary}\n\nDecision: keep onboarding scope unchanged and ship the checklist.`;

  await cleanupMeetingE2eSeed();
  try {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/meetings?tab=saved');
    await expect(page.getByRole('heading', { name: 'Meetings', exact: true })).toBeVisible();

    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Meeting URL').fill('https://meet.google.com/e2e-meet-final');
    await page.getByLabel('Description').fill('Customer launch readiness sync');
    await page.getByLabel('Aliases').fill(alias);
    await page.getByRole('checkbox', { name: 'Add a recurring schedule' }).check();
    await page.getByLabel('Start times').fill('09:30');
    await page.getByRole('checkbox', { name: 'Auto-join scheduled occurrences' }).check();
    await page.getByRole('checkbox', { name: /I confirm this team has permission/ }).check();
    await page.getByRole('button', { name: 'Save meeting' }).click();

    const savedMeeting = page
      .locator('section')
      .filter({ hasText: 'Saved meetings' })
      .locator('li')
      .filter({ hasText: title });
    await expect(savedMeeting.getByText('auto-join on')).toBeVisible();
    await expect(savedMeeting.getByText(alias)).toBeVisible();

    const scheduledCapture = page
      .locator('section')
      .filter({ hasText: 'Scheduled and recent captures' })
      .locator('li')
      .filter({ hasText: title })
      .filter({ hasText: 'scheduled' })
      .first();
    await expect(scheduledCapture).toBeVisible();

    const savedMeetingId = await waitForSavedMeetingIdByTitle(title);
    const meetingId = await seedFinalizedMeetingCapture({
      rawEventText,
      savedMeetingId,
      summary,
      title,
    });

    await page.goto('/app/meetings');
    const completedCapture = page.locator('li').filter({ hasText: title }).filter({
      hasText: 'completed',
    });
    await expect(completedCapture.first()).toBeVisible();
    await completedCapture
      .first()
      .getByRole('link', { name: literalPattern(title) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/app/meetings/${meetingId}`));
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(summary)).toBeVisible();
    await expect(page.getByText('Ada Lovelace:')).toBeVisible();
    await expect(
      page.getByText('Acme confirmed the launch checklist needs to go out today.'),
    ).toBeVisible();
    await expect(page.getByText('Grace Hopper:')).toBeVisible();
    await expect(
      page.getByText('Decision: keep onboarding scope unchanged and ship the checklist.'),
    ).toBeVisible();

    await page.goto('/app/timeline');
    await expect(page.getByText('Meeting summary captured').first()).toBeVisible();
    await expect(page.getByText(summary).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open transcript' })).toHaveAttribute(
      'href',
      `/app/meetings/${meetingId}`,
    );
  } finally {
    await cleanupMeetingE2eSeed();
  }
});

test('agentic core capture-to-approval journey creates durable task state', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');
  const stamp = Date.now();
  const commitment = `I'll send the agentic core proposal ${stamp} next Tuesday`;
  const expectedTask = commitment
    .replace(/^I'll\s+/i, '')
    .replace(/\s+next Tuesday$/i, '')
    .replace(/^./, (char) => char.toUpperCase());

  await ownerPage.goto('/app');
  const capture = await openHomeCapture(ownerPage);
  await capture.getByPlaceholder('What happened?').fill(commitment);
  await waitForPost(ownerPage, '/app', () => capture.getByRole('button', { name: 'Post' }).click());

  await processCapturedSuggestion(commitment);

  await ownerPage.goto('/app/approvals');
  await expect(ownerPage.getByRole('heading', { name: /Commitment:/ })).toBeVisible();
  await expect(ownerPage.getByText(commitment).first()).toBeVisible();
  await expect(ownerPage.getByText(expectedTask).first()).toBeVisible();
  await ownerPage.getByRole('button', { name: `Accept ${expectedTask}` }).click();
  await expect(ownerPage.getByText('No pending approvals')).toBeVisible();

  await ownerPage.goto('/app/tasks');
  await expect(ownerPage.getByText(expectedTask).first()).toBeVisible();

  await memberPage.goto('/app/tasks');
  await expect(memberPage.getByText(expectedTask).first()).toBeVisible();

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('Telegram voice approval journey creates durable task state', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const stamp = Date.now();
  const transcript = `I'll schedule the Telegram lead meeting ${stamp} next Monday`;
  const expectedTask = `Schedule the Telegram lead meeting ${stamp}`;

  await processTelegramVoiceSuggestion(transcript);

  await ownerPage.goto('/app/approvals');
  await expect(ownerPage.getByRole('heading', { name: /Commitment:/ })).toBeVisible();
  await expect(ownerPage.getByText(transcript).first()).toBeVisible();
  await expect(ownerPage.getByText(expectedTask).first()).toBeVisible();
  const approval = ownerPage.locator('article').filter({ hasText: expectedTask });
  await waitForPost(ownerPage, '/app/approvals', () =>
    approval.getByRole('button', { name: 'Accept' }).click(),
  );
  await expect(ownerPage.getByText('No pending approvals')).toBeVisible();

  await ownerPage.goto('/app/tasks');
  await expect(ownerPage.getByText(expectedTask).first()).toBeVisible();

  await ownerPage.context().close();
});

test('approvals failed filter shows retryable browser state', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const db = getDb();
  const sql = getDbClient();
  const stamp = Date.now();
  const taskTitle = `${E2E_PREFIX} retry failed approval ${stamp}`;
  const scope = withTeam(db, e2eTeam.id, e2eUsers.owner.id);
  const countsBefore = await scope.suggestions.getApprovalItemCounts();
  const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: `${E2E_PREFIX} failed approval bundle ${stamp}`,
    summary: 'A failed approval should stay reviewable from the failed filter.',
    reason: 'E2E failed approval state coverage.',
    confidence: 'medium',
    dedupeKey: `e2e-failed-approval-${stamp}`,
    visibility: 'team',
    items: [
      {
        operation: 'create',
        targetKind: 'task',
        title: taskTitle,
        dedupeKey: `e2e-failed-approval-${stamp}:item`,
        proposedPayload: { canonicalName: taskTitle },
      },
    ],
  });
  const itemId = bundle.items[0]?.id;
  if (!itemId) throw new Error('failed approval fixture did not create an item');
  await sql`
    UPDATE agent_suggestion_items
    SET status = 'failed',
        failure_reason = 'E2E approval retry failed',
        updated_at = NOW()
    WHERE id = ${itemId}
  `;

  try {
    await ownerPage.goto('/app/approvals?status=failed');
    const failedApproval = ownerPage.locator('article').filter({ hasText: taskTitle });
    await expect(failedApproval).toBeVisible();
    await expect(failedApproval.getByText('needs retry', { exact: true })).toBeVisible();
    await expect(failedApproval.getByText('E2E approval retry failed')).toBeVisible();
    await expect(failedApproval.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(failedApproval.getByRole('button', { name: 'Reject' })).toBeVisible();
    await expect(
      ownerPage.getByRole('link', { name: `pending ${countsBefore.pending}` }),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole('link', { name: `failed ${countsBefore.failed + 1}` }),
    ).toBeVisible();

    await ownerPage.goto('/app/approvals?status=pending');
    await expect(ownerPage.locator('article').filter({ hasText: taskTitle })).toHaveCount(0);

    await ownerPage.goto('/app/work');
    await expect(
      ownerPage.getByRole('link', { name: `${countsBefore.pending} pending approvals` }),
    ).toBeVisible();
    await expect(ownerPage.getByText(taskTitle)).toHaveCount(0);
  } finally {
    await sql`DELETE FROM agent_suggestions WHERE id = ${bundle.id}`;
    await ownerPage.context().close();
  }
});

test('approvals page bulk accept leaves merge proposals for review', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const db = getDb();
  const scope = withTeam(db, e2eTeam.id, e2eUsers.owner.id);
  const stamp = Date.now();
  const taskTitle = `${E2E_PREFIX} bulk accept task ${stamp}`;
  const calendarTitle = `${E2E_PREFIX} bulk accept calendar ${stamp}`;
  const first = await scope.objects.createObject({
    type: 'company',
    canonicalName: `${E2E_PREFIX} merge survivor ${stamp}`,
    actor: { kind: 'user', userId: e2eUsers.owner.id },
  });
  const second = await scope.objects.createObject({
    type: 'vendor',
    canonicalName: `${E2E_PREFIX} merge candidate ${stamp}`,
    actor: { kind: 'user', userId: e2eUsers.owner.id },
  });
  const actionBundle = await scope.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: `${E2E_PREFIX} bulk accept actions ${stamp}`,
    summary: 'Bulk accept should apply the first non-merge proposal.',
    reason: 'E2E mixed approval coverage.',
    confidence: 'medium',
    dedupeKey: `e2e-bulk-accept-action-one-${stamp}`,
    visibility: 'team',
    items: [
      {
        operation: 'create',
        targetKind: 'task',
        title: taskTitle,
        dedupeKey: `e2e-bulk-accept-action-one-${stamp}:task`,
        proposedPayload: { canonicalName: taskTitle },
      },
      {
        operation: 'create',
        targetKind: 'calendar_event',
        title: calendarTitle,
        dedupeKey: `e2e-bulk-accept-action-one-${stamp}:calendar`,
        proposedPayload: {
          title: calendarTitle,
          startAt: '2026-07-06T13:00:00.000Z',
          endAt: '2026-07-06T13:30:00.000Z',
          timezone: 'UTC',
        },
      },
    ],
  });
  const mergeBundle = await scope.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: `${E2E_PREFIX} bulk accept merge ${stamp}`,
    summary: 'Merge proposals need explicit preview review.',
    reason: 'E2E mixed approval coverage.',
    confidence: 'medium',
    dedupeKey: `e2e-bulk-accept-merge-${stamp}`,
    visibility: 'team',
    items: [
      {
        operation: 'merge',
        targetKind: 'object_merge',
        targetId: first.id,
        title: `${E2E_PREFIX} review merge ${stamp}`,
        dedupeKey: `e2e-bulk-accept-merge-${stamp}:item`,
        proposedPayload: {
          objectIds: [first.id, second.id],
          survivorId: first.id,
          reason: 'Names are close enough to require human review.',
        },
      },
    ],
  });
  const mergeItemId = mergeBundle.items[0]?.id;
  if (!mergeItemId) throw new Error('merge approval fixture did not create an item');

  try {
    await ownerPage.goto('/app/approvals');
    await expect(ownerPage.getByText('1 merge proposal needs review')).toHaveCount(0);
    await expect(ownerPage.getByRole('button', { name: 'Accept 2 visible' })).toHaveCount(0);
    await expect(ownerPage.getByRole('button', { name: 'Accept all visible' })).toHaveCount(0);
    await expect(ownerPage.locator('article').filter({ hasText: taskTitle })).toBeVisible();
    await expect(ownerPage.locator('article').filter({ hasText: calendarTitle })).toBeVisible();
    const mergeApproval = ownerPage.locator('article').filter({ hasText: mergeBundle.title });
    await expect(mergeApproval).toBeVisible();
    await expect(mergeApproval.getByRole('link', { name: /Review merge/ })).toBeVisible();

    await ownerPage.getByRole('checkbox', { name: `Select ${taskTitle}` }).check();
    await ownerPage.getByRole('checkbox', { name: `Select ${calendarTitle}` }).check();
    await waitForPost(ownerPage, '/app/approvals', () =>
      ownerPage.getByRole('button', { name: 'Accept', exact: true }).click(),
    );

    await expect(ownerPage.locator('article').filter({ hasText: actionBundle.title })).toHaveCount(
      0,
    );
    await expect(mergeApproval).toBeVisible();
    await expect(mergeApproval.getByRole('link', { name: /Review merge/ })).toBeVisible();
    expect(await scope.objects.getMergedObjectTarget(second.id)).toBeNull();

    await ownerPage.goto('/app/tasks');
    await expect(ownerPage.getByText(taskTitle).first()).toBeVisible();
  } finally {
    await scope.suggestions.rejectSuggestionItem(mergeItemId);
    await ownerPage.context().close();
  }
});

test('approvals page bulk accept recovers failed proposal rows', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const scope = withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id);
  const stamp = Date.now();
  const taskTitle = `${E2E_PREFIX} bulk failure task ${stamp}`;
  const calendarTitle = `${E2E_PREFIX} bulk failure calendar ${stamp}`;
  const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: `${E2E_PREFIX} bulk failure bundle ${stamp}`,
    summary: 'Bulk accept should keep invalid proposals reviewable after partial failure.',
    reason: 'E2E bulk failure recovery coverage.',
    confidence: 'medium',
    dedupeKey: `e2e-bulk-failure-${stamp}`,
    visibility: 'team',
    items: [
      {
        operation: 'create',
        targetKind: 'task',
        title: taskTitle,
        dedupeKey: `e2e-bulk-failure-${stamp}:task`,
        proposedPayload: { canonicalName: taskTitle },
      },
      {
        operation: 'create',
        targetKind: 'calendar_event',
        title: calendarTitle,
        dedupeKey: `e2e-bulk-failure-${stamp}:calendar`,
        proposedPayload: { title: calendarTitle },
      },
    ],
  });
  const calendarItemId = bundle.items.find((item) => item.title === calendarTitle)?.id;
  if (!calendarItemId) throw new Error('bulk failure fixture did not create a calendar item');

  try {
    await ownerPage.goto('/app/approvals?status=all');
    await ownerPage.getByRole('checkbox', { name: `Select ${taskTitle}` }).check();
    await ownerPage.getByRole('checkbox', { name: `Select ${calendarTitle}` }).check();
    await waitForPost(ownerPage, '/app/approvals', () =>
      ownerPage.getByRole('button', { name: 'Accept', exact: true }).click(),
    );

    await expect(ownerPage.getByText('1 item(s) failed to apply')).toBeVisible();
    await expect(ownerPage.locator('article').filter({ hasText: calendarTitle })).toBeVisible();

    await ownerPage.goto('/app/approvals?status=failed');
    const failedApproval = ownerPage.locator('article').filter({ hasText: calendarTitle });
    await expect(failedApproval).toBeVisible();
    await expect(
      failedApproval.getByText(
        'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
      ),
    ).toBeVisible();
    await expect(failedApproval.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(failedApproval.getByRole('button', { name: 'Reject' })).toBeVisible();

    await ownerPage.goto('/app/tasks');
    await expect(ownerPage.getByText(taskTitle).first()).toBeVisible();
  } finally {
    await scope.suggestions.rejectSuggestionItem(calendarItemId);
    await ownerPage.context().close();
  }
});

test('agentic core object update approval updates existing object', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');
  const stamp = Date.now();
  const objectName = `E2E update target ${stamp}`;
  const sourceText = `The ${objectName} account moved to proposal and is now doing`;

  await ownerPage.goto('/app/objects/new');
  await ownerPage.getByLabel('Type').selectOption('project');
  await ownerPage.getByLabel('Name').fill(objectName);
  await ownerPage.getByRole('button', { name: 'Create object' }).click();
  await expect(ownerPage).toHaveURL(/\/app\/objects\/[0-9a-f-]+/);
  const objectId = new URL(ownerPage.url()).pathname.split('/').at(-1);
  if (!objectId) throw new Error('created object id missing from URL');
  await expect(ownerPage.getByRole('heading', { name: objectName })).toBeVisible();
  await expect(ownerPage.getByLabel('Status')).toHaveValue('open');
  await expect(ownerPage.getByLabel('Stage')).toHaveValue('');

  await ownerPage.goto('/app');
  const capture = await openHomeCapture(ownerPage);
  await capture.getByPlaceholder('What happened?').fill(sourceText);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(sourceText).first()).toBeVisible();

  await processObjectUpdateSuggestion({
    text: sourceText,
    targetId: objectId,
    title: `Update ${objectName}`,
    proposedPayload: { status: 'active', stage: 'proposal' },
  });

  await ownerPage.goto('/app/approvals');
  const approval = ownerPage.locator('article').filter({ hasText: objectName });
  await expect(approval).toBeVisible();
  await expect(approval.getByText(sourceText).first()).toBeVisible();
  await expect(approval.getByText('Status Active')).toBeVisible();
  await expect(approval.getByText('Stage Proposal')).toBeVisible();
  await waitForPost(ownerPage, '/app/approvals', () =>
    approval.getByRole('button', { name: 'Accept' }).click(),
  );
  await expect(approval).toHaveCount(0);

  await ownerPage.goto(`/app/objects/${objectId}`);
  await expect(ownerPage.getByRole('heading', { name: objectName })).toBeVisible();
  await expect(ownerPage.getByLabel('Status')).toHaveValue('active');
  await expect(ownerPage.getByLabel('Stage')).toHaveValue('proposal');
  const recentChanges = ownerPage.locator('section').filter({
    has: ownerPage.getByRole('heading', { name: 'Recent changes' }),
  });
  await expect(
    recentChanges.locator('li').filter({ hasText: 'status' }).filter({ hasText: 'open → active' }),
  ).toBeVisible();
  await expect(
    recentChanges.locator('li').filter({ hasText: 'stage' }).filter({ hasText: 'proposal' }),
  ).toBeVisible();
  await expect(await countObjectsByName(objectName)).toBe(1);

  await memberPage.goto(`/app/objects/${objectId}`);
  await expect(memberPage.getByRole('heading', { name: objectName })).toBeVisible();
  await expect(memberPage.getByLabel('Status')).toHaveValue('active');
  await expect(memberPage.getByLabel('Stage')).toHaveValue('proposal');

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('Home Ask creates a persisted chat session', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const question = `What is blocked in E2E Home Ask ${Date.now()}?`;

  await ownerPage.goto('/app');
  const chatResponse = ownerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/chat' && response.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await ownerPage.getByPlaceholder('Ask the timeline…').fill(question);
  await ownerPage.getByRole('button', { name: 'Send' }).click();

  const sessionId = (await chatResponse).headers()['x-tl-session-id'];
  expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  await expect(ownerPage).toHaveURL(new RegExp(`/app/chat\\?session=${sessionId}`));
  await expect(ownerPage.getByText(question, { exact: true })).toBeVisible();
  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(new RegExp(`/app/chat\\?session=${sessionId}`));
  await expect(ownerPage.getByText(question, { exact: true })).toBeVisible();

  await ownerPage.context().close();
});

test('chat answers timeline questions with citations and reloadable tool history', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const stamp = Date.now();
  const chatFact = `E2E chat team fact ${stamp}`;

  await ownerPage.goto('/app');
  const capture = await openHomeCapture(ownerPage);
  await capture.getByPlaceholder('What happened?').fill(chatFact);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(chatFact).first()).toBeVisible();
  const rawEventId = await waitForRawEventIdByText(chatFact);

  await ownerPage.goto('/app/chat');
  const question = `What does the timeline say about ${chatFact}?`;
  await ownerPage.getByPlaceholder('Ask the timeline…').fill(question);
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(
    ownerPage.getByText(`Searched timeline for "${question}" — 1 result`).first(),
  ).toBeVisible();
  await expect(ownerPage.getByText(chatFact).last()).toBeVisible();
  await expect(
    ownerPage.getByRole('button', {
      name: `Open reference [ev:${rawEventId.slice(0, 8)}]`,
    }),
  ).toBeVisible();

  await expect(ownerPage).toHaveURL(/\/app\/chat\?session=/);
  const sessionUrl = ownerPage.url();
  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(sessionUrl);
  await expect(ownerPage.getByText(question).first()).toBeVisible();
  await expect(
    ownerPage.getByText(`Searched timeline for "${question}" — 1 result`).first(),
  ).toBeVisible();
  await expect(ownerPage.getByText(chatFact).last()).toBeVisible();
  await expect(
    ownerPage.getByRole('button', {
      name: `Open reference [ev:${rawEventId.slice(0, 8)}]`,
    }),
  ).toBeVisible();

  await ownerPage.getByPlaceholder('Ask the timeline…').fill('degraded chat check');
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(
    ownerPage.getByText("I couldn't verify that from the accessible timeline."),
  ).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: referenceButtonPattern('ev') })).toHaveCount(
    1,
  );

  await ownerPage.context().close();
});

test('chat respects private and specific-user timeline visibility', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');

  await memberPage.goto('/app/chat');
  const privateQuestion = `What does the timeline say about ${e2eSeedEvents.privateForOwner}?`;
  await memberPage.getByPlaceholder('Ask the timeline…').fill(privateQuestion);
  await memberPage.getByRole('button', { name: 'Send' }).click();
  await expect(
    memberPage.getByText("I couldn't verify that from the accessible timeline."),
  ).toBeVisible();
  await expect(memberPage.getByRole('button', { name: referenceButtonPattern('ev') })).toHaveCount(
    0,
  );

  const specificQuestion = `What does the timeline say about ${e2eSeedEvents.specificForMember}?`;
  await memberPage.getByPlaceholder('Ask the timeline…').fill(specificQuestion);
  await memberPage.getByRole('button', { name: 'Send' }).click();
  await expect(memberPage.getByText(e2eSeedEvents.specificForMember).last()).toBeVisible();
  await expect(
    memberPage.getByRole('button', { name: referenceButtonPattern('ev') }),
  ).toBeVisible();

  await ownerPage.goto('/app/chat');
  await ownerPage.getByPlaceholder('Ask the timeline…').fill(specificQuestion);
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(
    ownerPage.getByText("I couldn't verify that from the accessible timeline."),
  ).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: referenceButtonPattern('ev') })).toHaveCount(
    0,
  );

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('chat answers from accepted durable task calendar and object state', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');
  const stamp = Date.now();
  const commitment = `I'll prepare the durable state review ${stamp} next Tuesday`;
  const expectedTask = `Prepare the durable state review ${stamp}`;
  const objectName = `E2E durable object ${stamp}`;
  const sourceText = `The ${objectName} workspace object is now in review`;

  await ownerPage.goto('/app');
  const capture = await openHomeCapture(ownerPage);
  await capture.getByPlaceholder('What happened?').fill(commitment);
  await waitForPost(ownerPage, '/app', () => capture.getByRole('button', { name: 'Post' }).click());
  await processCapturedSuggestion(commitment);
  await ownerPage.goto('/app/approvals');
  const taskApproval = ownerPage.locator('article').filter({ hasText: expectedTask });
  await expect(taskApproval).toBeVisible();
  await waitForPost(ownerPage, '/app/approvals', () =>
    taskApproval.getByRole('button', { name: `Accept ${expectedTask}` }).click(),
  );
  await expect(taskApproval).toHaveCount(0);

  await ownerPage.goto('/app/objects/new');
  await ownerPage.getByLabel('Type').selectOption('project');
  await ownerPage.getByLabel('Name').fill(objectName);
  await ownerPage.getByRole('button', { name: 'Create object' }).click();
  await expect(ownerPage).toHaveURL(/\/app\/objects\/[0-9a-f-]+/);
  const objectId = new URL(ownerPage.url()).pathname.split('/').at(-1);
  if (!objectId) throw new Error('created object id missing from URL');

  await ownerPage.goto('/app');
  const secondCapture = await openHomeCapture(ownerPage);
  await secondCapture.getByPlaceholder('What happened?').fill(sourceText);
  await waitForPost(ownerPage, '/app', () =>
    secondCapture.getByRole('button', { name: 'Post' }).click(),
  );
  await processObjectUpdateSuggestion({
    text: sourceText,
    targetId: objectId,
    title: `Move ${objectName} to review`,
    proposedPayload: { stage: 'review' },
  });
  await ownerPage.goto('/app/approvals');
  const objectApproval = ownerPage.locator('article').filter({ hasText: objectName });
  await expect(objectApproval).toBeVisible();
  await objectApproval.getByRole('button', { name: 'Accept' }).click();
  await expect(objectApproval).toHaveCount(0);

  await ownerPage.goto('/app/chat');
  const question = `What durable task, calendar, and object state exists for ${stamp}?`;
  await ownerPage.getByPlaceholder('Ask the timeline…').fill(question);
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(ownerPage.getByText(/Listed workspace state/)).toBeVisible();
  await expect(ownerPage.getByText(expectedTask).last()).toBeVisible();
  await expect(ownerPage.getByText(objectName).last()).toBeVisible();
  await expect(ownerPage.getByText('Calendar:').last()).toBeVisible();
  await expect(
    ownerPage.getByRole('button', { name: referenceButtonPattern('ent') }).first(),
  ).toBeVisible();

  await expect(ownerPage).toHaveURL(/\/app\/chat\?session=/);
  const sessionUrl = ownerPage.url();
  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(sessionUrl);
  await expect(ownerPage.getByText(question).first()).toBeVisible();
  await expect(ownerPage.getByText(/Listed workspace state/)).toBeVisible();
  await expect(ownerPage.getByText(expectedTask).last()).toBeVisible();
  await expect(ownerPage.getByText(objectName).last()).toBeVisible();

  await memberPage.goto('/app/chat');
  await memberPage.getByPlaceholder('Ask the timeline…').fill(question);
  await memberPage.getByRole('button', { name: 'Send' }).click();
  await expect(memberPage.getByText(/Listed workspace state/)).toBeVisible();
  await expect(memberPage.getByText(expectedTask).last()).toBeVisible();
  await expect(memberPage.getByText(objectName).last()).toBeVisible();

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('global search renders semantic document and timeline results with filters', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const documentResult = {
    id: 'document:launch-plan:chunk-1',
    kind: 'document_chunk',
    title: 'Customer launch plan',
    snippet: 'Semantic match: rollout checklist, support owner, and renewal handoff.',
    href: '/app/documents/document-1?chunk=chunk-1',
    score: 0.96,
    scoreParts: { semantic: 0.96, intent: 0.65 },
    metadata: {
      source: 'integration',
      documentId: 'document-1',
      chunkId: 'chunk-1',
    },
  };
  const timelineResult = {
    id: 'event:launch-handoff',
    kind: 'timeline_event',
    title: 'Integration launch handoff',
    snippet: 'Semantic match from a provider event about the same customer launch.',
    href: '/app/timeline?event=launch-handoff',
    score: 0.88,
    scoreParts: { semantic: 0.88 },
    metadata: { source: 'integration' },
  };
  const requests: Array<{
    query?: string;
    kinds?: string[];
    source?: string[];
    mode?: string;
  }> = [];

  await ownerPage.route('**/api/search/global', async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      kinds?: string[];
      source?: string[];
      mode?: string;
    };
    requests.push(body);
    const results = body.kinds?.includes('document_chunk')
      ? [documentResult]
      : [documentResult, timelineResult];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        query: body.query ?? '',
        mode: body.mode ?? 'full',
        warnings: [],
        results,
      }),
    });
  });

  await ownerPage.goto('/app/search?q=customer+handoff&source=integration');
  await expect(ownerPage.getByRole('heading', { name: 'Search' })).toBeVisible();
  await expect(ownerPage.getByText('Customer launch plan')).toBeVisible();
  await expect(
    ownerPage.getByText('Semantic match: rollout checklist, support owner, and renewal handoff.'),
  ).toBeVisible();
  const documentSearchResult = ownerPage.getByRole('link', { name: /Customer launch plan/ });
  const timelineSearchResult = ownerPage.getByRole('link', {
    name: /Integration launch handoff/,
  });
  await expect(documentSearchResult.getByText('Document', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Integration launch handoff')).toBeVisible();
  await expect(timelineSearchResult.getByText('Timeline', { exact: true })).toBeVisible();
  await expect(documentSearchResult).toHaveAttribute(
    'href',
    '/app/documents/document-1?chunk=chunk-1',
  );

  await expect
    .poll(() => requests.at(-1))
    .toMatchObject({
      query: 'customer handoff',
      mode: 'full',
      source: ['integration'],
    });

  await ownerPage.getByRole('button', { name: 'Result types' }).click();
  await ownerPage.getByRole('menuitemcheckbox', { name: 'Documents' }).click();

  await expect
    .poll(() => requests.at(-1))
    .toMatchObject({
      query: 'customer handoff',
      mode: 'full',
      kinds: ['document_chunk'],
      source: ['integration'],
    });
  await expect(ownerPage.getByText('Customer launch plan')).toBeVisible();
  await expect(ownerPage.getByText('Integration launch handoff')).toHaveCount(0);

  await ownerPage.context().close();
});

test('team admin invite, role, and removal journeys enforce permissions', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const adminPage = await newSignedInPage(browser, 'admin');
  const memberPage = await newSignedInPage(browser, 'member');
  const inviteePage = await browser.newPage();

  await ownerPage.goto('/app/team?section=general');
  await expect(ownerPage.getByText('Team identity', { exact: true })).toBeVisible();
  await ownerPage.goto('/app/team?section=exports');
  await expect(ownerPage.getByText('Team export', { exact: true })).toBeVisible();
  await ownerPage.goto('/app/team?section=visibility');
  await expect(ownerPage.getByText('Visibility defaults', { exact: true })).toBeVisible();
  await ownerPage.goto('/app/team?section=members');
  await expect(ownerPage.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Invite a teammate', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Pending invites', { exact: true })).toBeVisible();

  await memberPage.goto('/app/team?section=members');
  await expect(memberPage.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
  await expect(memberPage.getByText('Team identity', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByText('Team export', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByText('Visibility defaults', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByText('Invite a teammate', { exact: true })).toHaveCount(0);

  await adminPage.goto('/app/team?section=members');
  await expect(adminPage.getByText('Invite a teammate', { exact: true })).toBeVisible();
  await expect(adminPage.getByLabel('Role', { exact: true })).toBeVisible();
  await expect(
    adminPage.getByLabel('Role', { exact: true }).locator('option[value="admin"]'),
  ).toHaveCount(0);

  await ownerPage.bringToFront();
  await ownerPage.goto('/app/team?section=members');
  await createMemberInvite(ownerPage, e2eUsers.pendingInvitee.email);
  await expect(ownerPage.getByText(e2eUsers.pendingInvitee.email).first()).toBeVisible();
  await waitForPost(ownerPage, '/app/team', () =>
    ownerPage
      .getByRole('button', { name: `Resend invite to ${e2eUsers.pendingInvitee.email}` })
      .click(),
  );
  await expect(
    ownerPage.getByRole('button', { name: `Revoke invite to ${e2eUsers.pendingInvitee.email}` }),
  ).toBeVisible();
  await waitForPost(ownerPage, '/app/team', () =>
    ownerPage
      .getByRole('button', { name: `Revoke invite to ${e2eUsers.pendingInvitee.email}` })
      .click(),
  );
  await expect(
    ownerPage.getByRole('button', { name: `Revoke invite to ${e2eUsers.pendingInvitee.email}` }),
  ).toHaveCount(0);
  await expect(ownerPage.getByText(e2eUsers.pendingInvitee.email)).toHaveCount(0);

  const inviteUrl = await createMemberInvite(ownerPage, e2eUsers.invitee.email);
  await inviteePage.goto(invitePath(inviteUrl));
  await expect(inviteePage.getByText('Accept invite', { exact: true })).toBeVisible();
  await inviteePage.getByRole('link', { name: 'Sign in' }).click();
  await signInFromCurrentPage(inviteePage, e2eUsers.invitee.email, /\/accept-invite\/[^/]+$/);
  await expect(
    inviteePage.getByRole('heading', { name: `Join ${e2eTeam.name}?`, exact: true }),
  ).toBeVisible();
  await inviteePage.getByRole('button', { name: 'Join team' }).click();
  await expect(inviteePage).toHaveURL(/\/app\/timeline/);
  await expect(inviteePage.getByText(`team · ${e2eTeam.name}`)).toBeVisible();

  await ownerPage.goto('/app/team?section=members');
  await expect(teamMemberRow(ownerPage, e2eUsers.invitee.email)).toBeVisible();
  await ownerPage.getByLabel(`Role for ${e2eUsers.invitee.name}`).selectOption('admin');
  await waitForPost(ownerPage, '/app/team', () =>
    teamMemberRow(ownerPage, e2eUsers.invitee.email).getByRole('button', { name: 'Save' }).click(),
  );
  await expect(ownerPage.getByLabel(`Role for ${e2eUsers.invitee.name}`)).toHaveValue('admin');
  await ownerPage.reload();
  await expect(ownerPage.getByLabel(`Role for ${e2eUsers.invitee.name}`)).toHaveValue('admin');

  await adminPage.reload();
  await expect(
    adminPage.getByRole('button', { name: `Remove ${e2eUsers.invitee.name}` }),
  ).toHaveCount(0);

  await waitForPost(ownerPage, '/app/team', () =>
    ownerPage.getByRole('button', { name: `Remove ${e2eUsers.invitee.name}` }).click(),
  );
  await expect(
    ownerPage.getByRole('button', { name: `Remove ${e2eUsers.invitee.name}` }),
  ).toHaveCount(0);
  await expect(ownerPage.getByText('Removed members', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText(e2eUsers.invitee.email).first()).toBeVisible();

  await inviteePage.goto('/app');
  await expect(inviteePage.getByRole('heading', { name: 'No team yet' })).toBeVisible();
  await expect(inviteePage.getByText(e2eTeam.name)).toHaveCount(0);

  await ownerPage.context().close();
  await adminPage.context().close();
  await memberPage.context().close();
  await inviteePage.context().close();
});

test('signed-in support form submits with team context', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const stamp = Date.now();
  const message = `E2E signed-in support request ${stamp} needs help with team export evidence.`;

  await ownerPage.goto('/help/support');
  await expect(
    ownerPage.getByRole('heading', {
      name: 'Tell us what broke, what you need, or what you want to buy.',
    }),
  ).toBeVisible();
  await expect(ownerPage.getByLabel('Name')).toHaveValue(e2eUsers.owner.name);
  await expect(ownerPage.getByLabel('Email')).toHaveValue(e2eUsers.owner.email);
  await ownerPage.getByLabel('Request type').selectOption('technical_support');
  await ownerPage.getByLabel('Message').fill(message);

  await waitForPost(ownerPage, '/help/support', () =>
    ownerPage.getByRole('button', { name: 'Send request' }).click(),
  );
  await expect(ownerPage.getByText(/We received your request|We saved your request/)).toBeVisible();

  const request = await waitForSupportRequestByMessage(message);
  expect(request).toMatchObject({
    currentPage: expect.stringContaining('/help/support'),
    email: e2eUsers.owner.email,
    name: e2eUsers.owner.name,
    requestType: 'technical_support',
    teamId: e2eTeam.id,
    userId: e2eUsers.owner.id,
  });
  expect(request.context).toMatchObject({
    teamName: e2eTeam.name,
    teamRole: 'owner',
    userEmail: e2eUsers.owner.email,
    userName: e2eUsers.owner.name,
  });

  await ownerPage.context().close();
});

test('team export can be queued and ready archives redirect to signed downloads', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const readyExportId = randomUUID();
  const objectKey = `e2e/${readyExportId}/team-export.zip`;

  await ownerPage.goto('/app/team?section=exports');
  await expect(ownerPage.getByText('Team export', { exact: true })).toBeVisible();
  await waitForPost(ownerPage, '/app/team', () =>
    ownerPage.getByRole('button', { name: 'Start export' }).click(),
  );
  const createdExport = await waitForLatestTeamExport({
    requestedByUserId: e2eUsers.owner.id,
    teamId: e2eTeam.id,
  });
  expect(['queued', 'failed']).toContain(createdExport.status);
  if (createdExport.status === 'queued') {
    await ownerPage.reload();
    await expect(ownerPage.locator('li').filter({ hasText: 'queued' }).first()).toBeVisible();
  } else {
    await expect(ownerPage.getByText('Export was created but could not be queued')).toBeVisible();
    expect(createdExport.error).toBeTruthy();
  }

  await seedReadyTeamExport({
    exportId: readyExportId,
    objectKey,
    requestedByUserId: e2eUsers.owner.id,
    teamId: e2eTeam.id,
  });
  await ownerPage.reload();
  const readyRow = ownerPage.locator('li').filter({
    has: ownerPage.locator(`input[value="${readyExportId}"]`),
  });
  await expect(readyRow.getByText('ready', { exact: true })).toBeVisible();
  const signedDownload = ownerPage.waitForURL(/X-Amz-Signature|X-Amz-Credential/);
  await readyRow.getByRole('button', { name: 'Download' }).click();
  await signedDownload;
  expect(ownerPage.url()).toContain('/timeline-exports/');
  expect(ownerPage.url()).toContain(objectKey);

  const sql = getDbClient();
  const auditRows = await sql<{ action: string }[]>`
    SELECT action
    FROM audit_log
    WHERE target_id = ${readyExportId}
      AND action = 'team.export_download'
    LIMIT 1
  `;
  expect(auditRows).toHaveLength(1);

  await ownerPage.context().close();
});

test('owner can create an object, update it, add a note, and archive it', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  const objectName = `E2E object ${Date.now()}`;
  const note = `E2E object note ${Date.now()}`;

  await page.goto('/app/objects/new');
  await page.getByLabel('Name').fill(objectName);
  await page.getByRole('button', { name: 'Create object' }).click();
  await expect(page).toHaveURL(/\/app\/objects\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { name: objectName })).toBeVisible();

  await page.getByLabel('Stage').fill('discovery');
  await page.getByLabel('Stage').blur();
  await expect(
    page.locator('li').filter({ hasText: 'stage' }).filter({ hasText: 'discovery' }),
  ).toBeVisible();

  await page.getByPlaceholder('Add a note. Each note also lands on the timeline.').fill(note);
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText(note).first()).toBeVisible();

  await page.getByRole('button', { name: 'Archive object' }).click();
  await expect(page.getByRole('button', { name: 'Archived' })).toBeVisible();
  await page.context().close();
});

test('owner can create a board and see matching objects on the board', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  const objectName = `E2E board object ${Date.now()}`;
  const boardName = `E2E board ${Date.now()}`;

  await page.goto('/app/objects/new');
  await page.getByLabel('Name').fill(objectName);
  await page.getByRole('button', { name: 'Create object' }).click();
  await expect(page.getByRole('heading', { name: objectName })).toBeVisible();

  await page.goto('/app/boards');
  await page.getByRole('button', { name: 'Create board' }).click();
  const boardDialog = page.getByRole('dialog', { name: 'New board' });
  await expect(boardDialog).toBeVisible();
  await boardDialog.getByRole('button', { name: /Task preset/ }).click();
  await boardDialog.getByRole('textbox', { name: 'Name', exact: true }).fill(boardName);
  await waitForPost(page, '/app/boards', () =>
    boardDialog.getByRole('button', { name: 'Create board' }).click(),
  );
  await expect(page).toHaveURL(/\/app\/boards\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(page.getByText(boardName).first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand add item' }).click();
  await page.getByRole('searchbox', { name: 'Search existing objects' }).fill(objectName);
  await page.getByRole('button', { name: new RegExp(objectName) }).click();
  await waitForPost(page, '/app/boards', () =>
    page.getByRole('button', { name: 'Add to board' }).click(),
  );
  await expect(page.getByRole('link', { name: objectName })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.context().close();
});

test('owner can link and unlink related objects from the object detail page', async ({
  browser,
}) => {
  const page = await newSignedInPage(browser, 'owner');
  const stamp = Date.now();
  const primaryName = `E2E relationship primary ${stamp}`;
  const secondaryName = `E2E relationship secondary ${stamp}`;
  const primaryId = await createObjectFromUi(page, primaryName);
  const secondaryId = await createObjectFromUi(page, secondaryName);

  await page.goto(`/app/objects/${primaryId}`);
  await expect(page.getByRole('heading', { name: primaryName })).toBeVisible();
  await expect(page.getByText('No relationships yet.')).toBeVisible();

  const searchResponse = page.waitForResponse((res) => {
    const url = new URL(res.url());
    return (
      url.pathname === '/api/objects/search' &&
      url.searchParams.get('q') === secondaryName &&
      res.request().method() === 'GET'
    );
  });
  await page.getByPlaceholder('Search objects').fill(secondaryName);
  await searchResponse;
  await page.getByRole('button', { name: literalPattern(secondaryName) }).click();
  await expect(page.getByText(`Selected ${secondaryName} · task`)).toBeVisible();

  await waitForPost(page, `/app/objects/${primaryId}`, () =>
    page.getByRole('button', { name: 'Link' }).click(),
  );
  await expect(page.getByRole('link', { name: secondaryName })).toBeVisible();
  await expect(page.getByText('related · task')).toBeVisible();

  await page.goto(`/app/objects/${secondaryId}`);
  await expect(page.getByRole('heading', { name: secondaryName })).toBeVisible();
  await expect(page.getByRole('link', { name: primaryName })).toBeVisible();
  await expect(page.getByText('related · task')).toBeVisible();

  await page.goto(`/app/objects/${primaryId}`);
  await waitForPost(
    page,
    `/app/objects/${primaryId}`,
    () =>
      page
        .locator('li')
        .filter({ hasText: secondaryName })
        .getByRole('button', { name: 'Unlink' })
        .click(),
    (response) => response.request().postData()?.includes(secondaryId) ?? false,
  );
  await expect(page.getByRole('link', { name: secondaryName })).toHaveCount(0);
  await expect(page.getByText('No relationships yet.')).toBeVisible();

  await page.goto(`/app/objects/${secondaryId}`);
  await expect(page.getByRole('link', { name: primaryName })).toHaveCount(0);
  await expect(page.getByText('No relationships yet.')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.context().close();
});

test('calendar events can be created, edited, deleted, and visibility-scoped', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');
  const stamp = Date.now();
  const teamTitle = `E2E calendar team ${stamp}`;
  const editedTitle = `E2E calendar edited ${stamp}`;
  const privateTitle = `E2E calendar private ${stamp}`;
  const scopedTimedTitle = `E2E calendar scoped timed ${stamp}`;

  await ownerPage.goto('/app/calendar?view=day&date=2026-06-02');
  await expect(ownerPage.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(ownerPage).toHaveURL(/view=day&date=2026-06-02/);

  await ownerPage.getByRole('button', { name: 'week', exact: true }).click();
  await expect(ownerPage).toHaveURL(/view=week&date=2026-06-02/);
  await ownerPage.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(ownerPage).toHaveURL(/view=week&date=2026-06-09/);
  await ownerPage.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(ownerPage).toHaveURL(/view=week&date=2026-06-02/);
  await ownerPage.getByRole('button', { name: 'month', exact: true }).click();
  await expect(ownerPage).toHaveURL(/view=month&date=2026-06-02/);
  const calendarTimezone = (await ownerPage.getByText(/ · ISO weeks$/).textContent())?.split(
    ' · ',
  )[0];
  expect(calendarTimezone).toBeTruthy();
  await ownerPage.getByRole('button', { name: 'Today', exact: true }).click();
  const workspaceToday = await ownerPage.evaluate((timezone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }, calendarTimezone!);
  await expect(ownerPage).toHaveURL(new RegExp(`view=month&date=${workspaceToday}`));
  await ownerPage.goto('/app/calendar?view=day&date=2026-06-02');

  await ownerPage.getByRole('button', { name: 'New' }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await ownerPage.getByLabel('Title').fill(teamTitle);
  await ownerPage.getByLabel('Start date').fill('2026-06-02');
  await ownerPage.getByLabel('End date (exclusive)').fill('2026-06-03');
  await ownerPage.getByLabel('Location').fill('E2E room');
  await waitForPost(ownerPage, '/app/calendar', async () => {
    await ownerPage.getByRole('button', { name: 'Save' }).click();
  });
  await expect(ownerPage.getByRole('button', { name: new RegExp(teamTitle) })).toBeVisible();

  await ownerPage.getByRole('button', { name: new RegExp(teamTitle) }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await ownerPage.getByLabel('Title').fill(editedTitle);
  await ownerPage.getByLabel('Location').fill('E2E edited room');
  await waitForPost(ownerPage, '/app/calendar', async () => {
    await ownerPage.getByRole('button', { name: 'Save' }).click();
  });
  await expect(ownerPage.getByRole('button', { name: new RegExp(editedTitle) })).toBeVisible();
  await expect(ownerPage.getByText('Saved')).toBeVisible();

  await memberPage.goto('/app/calendar?view=day&date=2026-06-02');
  await expect(memberPage.getByRole('button', { name: new RegExp(editedTitle) })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'New' }).click();
  await ownerPage.getByLabel('Title').fill(privateTitle);
  await ownerPage.getByLabel('Start date').fill('2026-06-02');
  await ownerPage.getByLabel('End date (exclusive)').fill('2026-06-03');
  await ownerPage.getByLabel('Visibility').selectOption('private');
  await waitForPost(ownerPage, '/app/calendar', async () => {
    await ownerPage.getByRole('button', { name: 'Save' }).click();
  });
  await expect(ownerPage.getByRole('button', { name: new RegExp(privateTitle) })).toBeVisible();

  await memberPage.reload();
  await expect(memberPage.getByText(privateTitle)).toHaveCount(0);

  await ownerPage.getByRole('button', { name: 'New' }).click();
  await ownerPage.getByLabel('Title').fill(scopedTimedTitle);
  await ownerPage.getByLabel('All day').uncheck();
  await ownerPage.getByLabel('Start').fill('2026-06-02T14:00');
  await ownerPage.getByLabel('End').fill('2026-06-02T15:00');
  await ownerPage.getByLabel('Visibility').selectOption('specific_users');
  await ownerPage.getByLabel(e2eUsers.member.name).check();
  await ownerPage.getByLabel('Show as').selectOption('tentative');
  await ownerPage.getByLabel('Repeats').selectOption('weekly');
  await expect(ownerPage.getByLabel('RRULE')).toHaveValue('FREQ=WEEKLY');
  await waitForPost(ownerPage, '/app/calendar', async () => {
    await ownerPage.getByRole('button', { name: 'Save' }).click();
  });
  const scopedTimedOwnerEvent = ownerPage
    .getByRole('button', { name: new RegExp(scopedTimedTitle) })
    .first();
  await expect(scopedTimedOwnerEvent).toBeVisible();
  await expect(scopedTimedOwnerEvent).toContainText('Tentative');

  await memberPage.reload();
  await expect(
    memberPage.getByRole('button', { name: new RegExp(scopedTimedTitle) }).first(),
  ).toBeVisible();

  await scopedTimedOwnerEvent.click();
  await expect(ownerPage.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await expect(ownerPage.getByLabel('All day')).not.toBeChecked();
  await expect(ownerPage.getByLabel('Show as')).toHaveValue('tentative');
  await expect(ownerPage.getByLabel('Repeats')).toHaveValue('weekly');
  await expect(ownerPage.getByLabel('RRULE')).toHaveValue('RRULE:FREQ=WEEKLY');
  await ownerPage.getByLabel('Show as').selectOption('free');
  await ownerPage.getByLabel('Edit scope').selectOption('this_and_future');
  await waitForPost(ownerPage, '/app/calendar', async () => {
    await ownerPage.getByRole('button', { name: 'Save' }).click();
  });
  await ownerPage
    .getByRole('button', { name: new RegExp(scopedTimedTitle) })
    .first()
    .click();
  await expect(ownerPage.getByLabel('Show as')).toHaveValue('free');
  await ownerPage.getByLabel('Edit scope').selectOption('series');
  await waitForPost(ownerPage, '/app/calendar', async () => {
    await ownerPage.getByRole('button', { name: 'Delete' }).click();
  });
  await expect(ownerPage.getByRole('button', { name: new RegExp(scopedTimedTitle) })).toHaveCount(
    0,
  );
  await memberPage.reload();
  await expect(memberPage.getByRole('button', { name: new RegExp(scopedTimedTitle) })).toHaveCount(
    0,
  );

  await ownerPage.getByRole('button', { name: new RegExp(editedTitle) }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await waitForPost(ownerPage, '/app/calendar', async () => {
    await ownerPage.getByRole('button', { name: 'Delete' }).click();
  });
  await expect(ownerPage.getByRole('button', { name: new RegExp(editedTitle) })).toHaveCount(0);

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('calendar event list search, scope, and pagination use real page data', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const scope = withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id);
  const sql = getDbClient();
  const stamp = String(Date.now());
  const metadata = { e2e: 'calendar-event-list', stamp };

  for (let index = 1; index <= 13; index += 1) {
    const day = String(index).padStart(2, '0');
    const label = String(index).padStart(2, '0');
    await scope.calendar.createCalendarEvent({
      title: `${E2E_PREFIX} calendar list future ${label} ${stamp}`,
      startAt: new Date(`2026-08-${day}T09:00:00.000Z`),
      endAt: new Date(`2026-08-${day}T09:30:00.000Z`),
      timezone: 'UTC',
      allDay: false,
      visibility: 'team',
      metadata,
    });
  }
  await scope.calendar.createCalendarEvent({
    title: `${E2E_PREFIX} calendar list past ${stamp}`,
    startAt: new Date('2026-06-03T09:00:00.000Z'),
    endAt: new Date('2026-06-03T09:30:00.000Z'),
    timezone: 'UTC',
    allDay: false,
    visibility: 'team',
    metadata,
  });

  try {
    await ownerPage.goto(`/app/calendar?view=month&date=2026-08-01&eventQ=${stamp}`);
    const eventList = ownerPage.locator('section').filter({ hasText: 'Calendar events' });

    await expect(eventList.getByText('13 upcoming events')).toBeVisible();
    await expect(eventList.getByText('Page 1 / 2')).toBeVisible();
    await expect(
      eventList.getByRole('button', {
        name: new RegExp(`${E2E_PREFIX} calendar list future 01 ${stamp}`),
      }),
    ).toBeVisible();

    await eventList.getByRole('button', { name: 'Next events' }).click();
    await expect(ownerPage).toHaveURL(/eventPage=2/);
    await expect(eventList.getByText('13-13 of 13')).toBeVisible();
    await expect(
      eventList.getByRole('button', {
        name: new RegExp(`${E2E_PREFIX} calendar list future 13 ${stamp}`),
      }),
    ).toBeVisible();

    await eventList.getByRole('button', { name: 'past' }).click();
    await expect(ownerPage).toHaveURL(/eventScope=past/);
    await expect(ownerPage).not.toHaveURL(/eventPage=2/);
    await expect(eventList.getByText('1 past event')).toBeVisible();
    await expect(
      eventList.getByRole('button', {
        name: new RegExp(`${E2E_PREFIX} calendar list past ${stamp}`),
      }),
    ).toBeVisible();

    await eventList.getByRole('button', { name: 'all' }).click();
    await expect(ownerPage).toHaveURL(/eventScope=all/);
    await expect(eventList.getByText('14 all events')).toBeVisible();
  } finally {
    await sql`
      DELETE FROM calendar_events
      WHERE team_id = ${e2eTeam.id}
        AND metadata ->> 'e2e' = 'calendar-event-list'
        AND metadata ->> 'stamp' = ${stamp}
    `;
    await ownerPage.context().close();
  }
});

test('documents can be organized, uploaded, renamed, deleted, and visibility-scoped', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');
  const stamp = Date.now();
  const folderName = `E2E documents ${stamp}`;
  const documentName = `E2E document ${stamp}.txt`;
  const renamedDocumentName = `E2E document renamed ${stamp}.txt`;
  const privateDocumentName = `E2E private document ${stamp}.txt`;
  const teamDocumentName = `E2E team document ${stamp}.txt`;

  await ownerPage.goto('/app/documents');
  await expect(ownerPage.getByPlaceholder('Search document chunks')).toBeVisible();

  await ownerPage.getByRole('button', { name: 'New folder' }).click();
  const newFolderDialog = ownerPage.getByRole('dialog', { name: 'New folder' });
  await expect(newFolderDialog).toBeVisible();
  await newFolderDialog.getByLabel('Folder name').fill(folderName);
  await newFolderDialog.getByRole('button', { name: 'Create folder' }).click();
  await expect(ownerPage.getByRole('link', { name: folderName })).toBeVisible();

  await ownerPage.getByRole('link', { name: folderName }).click();
  await expect(ownerPage).toHaveURL(/\/app\/documents\?folder=/);
  await expect(ownerPage.locator('nav').getByText(folderName, { exact: true })).toBeVisible();

  await uploadTextDocument(
    ownerPage,
    documentName,
    `Document body for the E2E upload journey ${stamp}.`,
  );
  await ownerPage.getByRole('link', { name: literalPattern(documentName) }).click();
  await expect(ownerPage).toHaveURL(/\/app\/documents\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
  await expect(ownerPage.getByText(documentName).first()).toBeVisible();
  await expect(ownerPage.getByText('Version history')).toBeVisible();
  await expect(ownerPage.getByText('v1', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('current', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('text/plain').first()).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Rename' }).click();
  const renameDialog = ownerPage.getByRole('dialog', { name: 'Rename document' });
  await expect(renameDialog).toBeVisible();
  await renameDialog.getByLabel('Name').fill(renamedDocumentName);
  await renameDialog.getByRole('button', { name: 'Rename' }).click();
  await expect(ownerPage.getByText(renamedDocumentName).first()).toBeVisible();

  await ownerPage.getByRole('link', { name: 'Back' }).click();
  await expect(
    ownerPage.getByRole('link', { name: literalPattern(renamedDocumentName) }),
  ).toBeVisible();

  await ownerPage.getByRole('link', { name: literalPattern(renamedDocumentName) }).click();
  await expect(ownerPage).toHaveURL(/\/app\/documents\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
  await ownerPage.getByRole('button', { name: 'Delete' }).click();
  const deleteDialog = ownerPage.getByRole('dialog', { name: 'Delete document?' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete document' }).click();
  await expect(ownerPage).toHaveURL(/\/app\/documents\?folder=/);
  await expect(ownerPage.getByText(renamedDocumentName)).toHaveCount(0);

  await ownerPage.getByLabel('New item visibility').selectOption('private');
  await uploadTextDocument(
    ownerPage,
    privateDocumentName,
    `Private document body for the E2E upload journey ${stamp}.`,
  );

  await ownerPage.getByLabel('New item visibility').selectOption('team');
  await uploadTextDocument(
    ownerPage,
    teamDocumentName,
    `Team document body for the E2E upload journey ${stamp}.`,
  );

  await memberPage.goto(ownerPage.url());
  await expect(
    memberPage.getByRole('link', { name: literalPattern(teamDocumentName) }),
  ).toBeVisible();
  await expect(memberPage.getByText(privateDocumentName)).toHaveCount(0);
  await memberPage.getByRole('link', { name: literalPattern(teamDocumentName) }).click();
  await expect(memberPage).toHaveURL(/\/app\/documents\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
  await expect(memberPage.getByText(teamDocumentName).first()).toBeVisible();
  await expect(memberPage.getByText('v1', { exact: true })).toBeVisible();

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('document search returns worker-embedded chunks and opens the cited chunk', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const sql = getDbClient();
  const db = getDb();
  const stamp = String(Date.now());
  const documentName = `E2E searchable renewal memo ${stamp}.txt`;
  const chunkText = `E2E searchable renewal memo ${stamp}: Mira owns the support handoff and the launch risk is export backfill.`;
  let documentId: string | null = null;

  try {
    const scope = withTeam(db, e2eTeam.id, e2eUsers.owner.id).documents;
    const created = await scope.createDocument({
      name: documentName,
      filename: documentName,
      contentType: 'text/plain',
      visibility: 'team',
      metadata: { e2e: 'document-search', stamp },
    });
    documentId = created.document.id;
    const chunkRows = await sql<{ id: string }[]>`
      INSERT INTO document_chunks (
        team_id,
        document_id,
        document_version_id,
        chunk_index,
        representation_kind,
        text,
        summary,
        token_count
      )
      VALUES (
        ${e2eTeam.id},
        ${created.document.id},
        ${created.version.id},
        0,
        'source_text',
        ${chunkText},
        ${'Mira owns support handoff; launch risk is export backfill.'},
        18
      )
      RETURNING id
    `;
    const chunkId = chunkRows[0]?.id;
    if (!chunkId) throw new Error('Failed to seed document chunk');
    await sql`
      UPDATE documents
      SET current_version_id = ${created.version.id}
      WHERE id = ${created.document.id}
    `;
    await sql`
      UPDATE document_versions
      SET byte_size = ${chunkText.length},
          processing_status = 'embedded',
          embedding_model_version = 'openai/text-embedding-3-small'
      WHERE id = ${created.version.id}
    `;

    await processEmbedJobForTests(
      { db },
      { scope: 'doc_chunk', teamId: e2eTeam.id, documentChunkId: chunkId },
    );

    await ownerPage.goto('/app/documents');
    await ownerPage.getByPlaceholder('Search document chunks').fill(chunkText);
    await waitForPost(ownerPage, '/api/documents/search', () =>
      ownerPage.getByRole('button', { name: 'Search' }).click(),
    );

    const result = ownerPage.locator(
      `a[href="/app/documents/${created.document.id}?version=1#chunk-${chunkId}"]`,
    );
    await expect(result).toBeVisible();
    await expect(result).toContainText('v1 · document');
    await expect(result).not.toContainText('source text');
    await expect(result).toContainText('Mira owns support handoff');
    await result.click();

    await expect(ownerPage).toHaveURL(
      new RegExp(`/app/documents/${created.document.id}\\?version=1#chunk-${chunkId}$`),
    );
    await expect(ownerPage.locator(`#chunk-${chunkId}`)).toContainText('Mira owns support handoff');
  } finally {
    await sql`
      DELETE FROM documents
      WHERE team_id = ${e2eTeam.id}
        AND metadata ->> 'e2e' = 'document-search'
        AND metadata ->> 'stamp' = ${stamp}
    `;
    if (documentId) {
      await sql`
        DELETE FROM documents
        WHERE team_id = ${e2eTeam.id}
          AND id = ${documentId}
      `;
    }
    await ownerPage.context().close();
  }
});
