import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';
import { getDb, getDbClient } from '@timeline/db';
import { handleUpdate, type TelegramApi } from '@timeline/shared/telegram';

import { processSuggestionJobForTests } from '../apps/worker/src/workers/suggestions.js';
import { processTranscribeJobForTests } from '../apps/worker/src/workers/transcribe.js';
import { newSignedInPage, signIn, signInFromCurrentPage } from './helpers.js';
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

async function uploadTextDocument(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Upload$/ }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole('status').getByText(name)).toBeVisible();
  await expect(page.getByRole('link', { name: literalPattern(name) })).toBeVisible();
}

async function createMemberInvite(page: Page, email: string): Promise<string> {
  await page.getByLabel('Email').fill(email);
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

async function waitForTeamSettingsPost(page: Page, action: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse(
    (res) => res.url().includes('/app/team') && res.request().method() === 'POST',
  );
  await action();
  await response;
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

  await processTranscribeJobForTests({ db }, job, {
    headObject: async () => ({ contentLength: 18 }),
    getObjectBuffer: async () => ({ body: uploaded.get(job.audioKey) ?? Buffer.from('missing') }),
    transcribeAudio: async () => ({ text: transcript, model: 'e2e-whisper' }),
    enqueueExtract: async () => undefined,
    enqueueEmbed: async () => undefined,
    enqueueSuggestion: async () => undefined,
  });
  await processSuggestionJobForTests(
    { db },
    { rawEventId: job.rawEventId, teamId: e2eTeam.id },
    {
      getEnv: () => ({ OPENROUTER_API_KEY: 'e2e-test-key' }) as never,
      chatStructured: async () => ({ object: { bundles: [] }, model: 'e2e' }) as never,
      modelId: 'e2e-telegram-suggestion-model',
    },
  );
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
  await expect(page.getByRole('heading', { name: /Home dashboard/i })).toBeVisible();

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

test('timeline capture enforces team, private, specific-user, and cross-team visibility', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const teamNote = `E2E team note ${Date.now()}`;

  await ownerPage.goto('/app');
  const capture = ownerPage.getByRole('region', { name: 'Capture' });
  await expect(capture.locator('form[data-capture-ready="true"]')).toBeVisible();
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
  const capture = ownerPage.getByRole('region', { name: 'Capture' });
  await expect(capture.locator('form[data-capture-ready="true"]')).toBeVisible();
  await capture.getByPlaceholder('What happened?').fill(commitment);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(commitment).first()).toBeVisible();

  await processCapturedSuggestion(commitment);

  await ownerPage.goto('/app/approvals');
  await expect(ownerPage.getByRole('heading', { name: /Commitment:/ })).toBeVisible();
  await expect(ownerPage.getByText(commitment).first()).toBeVisible();
  await expect(ownerPage.getByText(expectedTask).first()).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Accept all' }).click();
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
  await ownerPage.getByRole('button', { name: 'Accept all' }).click();
  await expect(ownerPage.getByText('No pending approvals')).toBeVisible();

  await ownerPage.goto('/app/tasks');
  await expect(ownerPage.getByText(expectedTask).first()).toBeVisible();

  await ownerPage.context().close();
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
  const capture = ownerPage.getByRole('region', { name: 'Capture' });
  await expect(capture.locator('form[data-capture-ready="true"]')).toBeVisible();
  await capture.getByPlaceholder('What happened?').fill(sourceText);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(sourceText).first()).toBeVisible();

  await processObjectUpdateSuggestion({
    text: sourceText,
    targetId: objectId,
    title: `Update ${objectName}`,
    proposedPayload: { status: 'doing', stage: 'proposal' },
  });

  await ownerPage.goto('/app/approvals');
  const approval = ownerPage.locator('article').filter({ hasText: objectName });
  await expect(approval).toBeVisible();
  await expect(approval.getByText(sourceText).first()).toBeVisible();
  await expect(approval.getByText('status: doing')).toBeVisible();
  await expect(approval.getByText('stage: proposal')).toBeVisible();
  await approval.getByRole('button', { name: 'Accept' }).click();
  await expect(approval).toHaveCount(0);

  await ownerPage.goto(`/app/objects/${objectId}`);
  await expect(ownerPage.getByRole('heading', { name: objectName })).toBeVisible();
  await expect(ownerPage.getByLabel('Status')).toHaveValue('doing');
  await expect(ownerPage.getByLabel('Stage')).toHaveValue('proposal');
  const recentChanges = ownerPage.locator('section').filter({
    has: ownerPage.getByRole('heading', { name: 'Recent changes' }),
  });
  await expect(
    recentChanges.locator('li').filter({ hasText: 'status' }).filter({ hasText: 'open → doing' }),
  ).toBeVisible();
  await expect(
    recentChanges.locator('li').filter({ hasText: 'stage' }).filter({ hasText: 'proposal' }),
  ).toBeVisible();
  await expect(await countObjectsByName(objectName)).toBe(1);

  await memberPage.goto(`/app/objects/${objectId}`);
  await expect(memberPage.getByRole('heading', { name: objectName })).toBeVisible();
  await expect(memberPage.getByLabel('Status')).toHaveValue('doing');
  await expect(memberPage.getByLabel('Stage')).toHaveValue('proposal');

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('chat answers timeline questions with citations and reloadable tool history', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const stamp = Date.now();
  const chatFact = `E2E chat team fact ${stamp}`;

  await ownerPage.goto('/app');
  const capture = ownerPage.getByRole('region', { name: 'Capture' });
  await expect(capture.locator('form[data-capture-ready="true"]')).toBeVisible();
  await capture.getByPlaceholder('What happened?').fill(chatFact);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(chatFact).first()).toBeVisible();
  const rawEventId = await waitForRawEventIdByText(chatFact);

  await ownerPage.goto('/app/chat');
  const question = `What does the timeline say about ${chatFact}?`;
  await ownerPage.getByPlaceholder("Ask anything about your team's timeline…").fill(question);
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(ownerPage.getByText(`Searched timeline for "${question}" — 1 result`)).toBeVisible();
  await expect(ownerPage.getByText(chatFact).last()).toBeVisible();
  const citation = ownerPage.getByRole('link', {
    name: `Citation ev:${rawEventId.slice(0, 8)}, source Event.`,
  });
  await expect(citation).toBeVisible();
  await expect(citation).toHaveAttribute('href', `/app/timeline#ev-${rawEventId}`);

  await expect(ownerPage).toHaveURL(/\/app\/chat\?session=/);
  const sessionUrl = ownerPage.url();
  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(sessionUrl);
  await expect(ownerPage.getByText(question).first()).toBeVisible();
  await expect(ownerPage.getByText(`Searched timeline for "${question}" — 1 result`)).toBeVisible();
  await expect(ownerPage.getByText(chatFact).last()).toBeVisible();
  await expect(citation).toBeVisible();

  await ownerPage
    .getByPlaceholder("Ask anything about your team's timeline…")
    .fill('degraded chat check');
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(
    ownerPage.getByText("I couldn't verify that from the accessible timeline."),
  ).toBeVisible();
  await expect(ownerPage.getByRole('link', { name: /Citation ev:/ })).toHaveCount(1);

  await ownerPage.context().close();
});

test('chat respects private and specific-user timeline visibility', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');

  await memberPage.goto('/app/chat');
  const privateQuestion = `What does the timeline say about ${e2eSeedEvents.privateForOwner}?`;
  await memberPage
    .getByPlaceholder("Ask anything about your team's timeline…")
    .fill(privateQuestion);
  await memberPage.getByRole('button', { name: 'Send' }).click();
  await expect(
    memberPage.getByText("I couldn't verify that from the accessible timeline."),
  ).toBeVisible();
  await expect(memberPage.getByRole('link', { name: /Citation ev:/ })).toHaveCount(0);

  const specificQuestion = `What does the timeline say about ${e2eSeedEvents.specificForMember}?`;
  await memberPage
    .getByPlaceholder("Ask anything about your team's timeline…")
    .fill(specificQuestion);
  await memberPage.getByRole('button', { name: 'Send' }).click();
  await expect(memberPage.getByText(e2eSeedEvents.specificForMember).last()).toBeVisible();
  await expect(memberPage.getByRole('link', { name: /Citation ev:/ })).toBeVisible();

  await ownerPage.goto('/app/chat');
  await ownerPage
    .getByPlaceholder("Ask anything about your team's timeline…")
    .fill(specificQuestion);
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(
    ownerPage.getByText("I couldn't verify that from the accessible timeline."),
  ).toBeVisible();
  await expect(ownerPage.getByRole('link', { name: /Citation ev:/ })).toHaveCount(0);

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
  const capture = ownerPage.getByRole('region', { name: 'Capture' });
  await expect(capture.locator('form[data-capture-ready="true"]')).toBeVisible();
  await capture.getByPlaceholder('What happened?').fill(commitment);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(commitment).first()).toBeVisible();
  await processCapturedSuggestion(commitment);
  await ownerPage.goto('/app/approvals');
  await expect(ownerPage.getByText(expectedTask).first()).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Accept all' }).click();
  await expect(ownerPage.getByText('No pending approvals')).toBeVisible();

  await ownerPage.goto('/app/objects/new');
  await ownerPage.getByLabel('Type').selectOption('project');
  await ownerPage.getByLabel('Name').fill(objectName);
  await ownerPage.getByRole('button', { name: 'Create object' }).click();
  await expect(ownerPage).toHaveURL(/\/app\/objects\/[0-9a-f-]+/);
  const objectId = new URL(ownerPage.url()).pathname.split('/').at(-1);
  if (!objectId) throw new Error('created object id missing from URL');

  await ownerPage.goto('/app');
  await capture.getByPlaceholder('What happened?').fill(sourceText);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(sourceText).first()).toBeVisible();
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
  await ownerPage.getByPlaceholder("Ask anything about your team's timeline…").fill(question);
  await ownerPage.getByRole('button', { name: 'Send' }).click();
  await expect(ownerPage.getByText(/Listed workspace state/)).toBeVisible();
  await expect(ownerPage.getByText(expectedTask).last()).toBeVisible();
  await expect(ownerPage.getByText(objectName).last()).toBeVisible();
  await expect(ownerPage.getByText('Calendar:').last()).toBeVisible();
  await expect(ownerPage.getByRole('link', { name: /Citation ent:/ }).first()).toBeVisible();

  await expect(ownerPage).toHaveURL(/\/app\/chat\?session=/);
  const sessionUrl = ownerPage.url();
  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(sessionUrl);
  await expect(ownerPage.getByText(question).first()).toBeVisible();
  await expect(ownerPage.getByText(/Listed workspace state/)).toBeVisible();
  await expect(ownerPage.getByText(expectedTask).last()).toBeVisible();
  await expect(ownerPage.getByText(objectName).last()).toBeVisible();

  await memberPage.goto('/app/chat');
  await memberPage.getByPlaceholder("Ask anything about your team's timeline…").fill(question);
  await memberPage.getByRole('button', { name: 'Send' }).click();
  await expect(memberPage.getByText(/Listed workspace state/)).toBeVisible();
  await expect(memberPage.getByText(expectedTask).last()).toBeVisible();
  await expect(memberPage.getByText(objectName).last()).toBeVisible();

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('team admin invite, role, and removal journeys enforce permissions', async ({ browser }) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const adminPage = await newSignedInPage(browser, 'admin');
  const memberPage = await newSignedInPage(browser, 'member');
  const inviteePage = await browser.newPage();

  await ownerPage.goto('/app/team');
  await expect(ownerPage.getByText('Team identity', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Team export', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Visibility defaults', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Members', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Invite a teammate', { exact: true })).toBeVisible();
  await expect(ownerPage.getByText('Pending invites', { exact: true })).toBeVisible();

  await memberPage.goto('/app/team');
  await expect(memberPage.getByText('Members', { exact: true })).toBeVisible();
  await expect(memberPage.getByText('Team identity', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByText('Team export', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByText('Visibility defaults', { exact: true })).toHaveCount(0);
  await expect(memberPage.getByText('Invite a teammate', { exact: true })).toHaveCount(0);

  await adminPage.goto('/app/team');
  await expect(adminPage.getByText('Invite a teammate', { exact: true })).toBeVisible();
  await expect(adminPage.getByLabel('Role', { exact: true })).toBeVisible();
  await expect(
    adminPage.getByLabel('Role', { exact: true }).locator('option[value="admin"]'),
  ).toHaveCount(0);

  await ownerPage.bringToFront();
  await ownerPage.goto('/app/team');
  await createMemberInvite(ownerPage, e2eUsers.pendingInvitee.email);
  await expect(ownerPage.getByText(e2eUsers.pendingInvitee.email).first()).toBeVisible();
  await waitForTeamSettingsPost(ownerPage, () =>
    ownerPage
      .getByRole('button', { name: `Resend invite to ${e2eUsers.pendingInvitee.email}` })
      .click(),
  );
  await expect(
    ownerPage.getByRole('button', { name: `Revoke invite to ${e2eUsers.pendingInvitee.email}` }),
  ).toBeVisible();
  await waitForTeamSettingsPost(ownerPage, () =>
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
  await expect(inviteePage.getByText(`Join ${e2eTeam.name}?`, { exact: true })).toBeVisible();
  await inviteePage.getByRole('button', { name: 'Join team' }).click();
  await expect(inviteePage).toHaveURL(/\/app\/timeline/);
  await expect(inviteePage.getByText(`team · ${e2eTeam.name}`)).toBeVisible();

  await ownerPage.goto('/app/team');
  await expect(teamMemberRow(ownerPage, e2eUsers.invitee.email)).toBeVisible();
  await ownerPage.getByLabel(`Role for ${e2eUsers.invitee.email}`).selectOption('admin');
  await waitForTeamSettingsPost(ownerPage, () =>
    teamMemberRow(ownerPage, e2eUsers.invitee.email).getByRole('button', { name: 'Save' }).click(),
  );
  await expect(ownerPage.getByLabel(`Role for ${e2eUsers.invitee.email}`)).toHaveValue('admin');
  await ownerPage.reload();
  await expect(ownerPage.getByLabel(`Role for ${e2eUsers.invitee.email}`)).toHaveValue('admin');

  await adminPage.reload();
  await expect(
    adminPage.getByRole('button', { name: `Remove ${e2eUsers.invitee.email}` }),
  ).toHaveCount(0);

  await waitForTeamSettingsPost(ownerPage, () =>
    ownerPage.getByRole('button', { name: `Remove ${e2eUsers.invitee.email}` }).click(),
  );
  await expect(
    ownerPage.getByRole('button', { name: `Remove ${e2eUsers.invitee.email}` }),
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
  await page.getByLabel('Name').fill(boardName);
  await page.getByLabel('Filter: type').selectOption('task');
  await page.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/app\/boards\/[0-9a-f-]+/);
  await expect(page.getByText(boardName).first()).toBeVisible();
  await expect(page.getByRole('link', { name: objectName })).toBeVisible();
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

  await ownerPage.goto('/app/calendar?view=day&date=2026-06-02');
  await expect(ownerPage.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'New' }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await ownerPage.getByLabel('Title').fill(teamTitle);
  await ownerPage.getByLabel('Start date').fill('2026-06-02');
  await ownerPage.getByLabel('End date (exclusive)').fill('2026-06-03');
  await ownerPage.getByLabel('Location').fill('E2E room');
  await ownerPage.getByRole('button', { name: 'Save' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(teamTitle) })).toBeVisible();

  await ownerPage.getByRole('button', { name: new RegExp(teamTitle) }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await ownerPage.getByLabel('Title').fill(editedTitle);
  await ownerPage.getByLabel('Location').fill('E2E edited room');
  await ownerPage.getByRole('button', { name: 'Save' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(editedTitle) })).toBeVisible();
  await expect(ownerPage.getByText('Saved')).toBeVisible();

  await memberPage.goto('/app/calendar?view=day&date=2026-06-02');
  await expect(memberPage.getByRole('button', { name: new RegExp(editedTitle) })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'New' }).click();
  await ownerPage.getByLabel('Title').fill(privateTitle);
  await ownerPage.getByLabel('Start date').fill('2026-06-02');
  await ownerPage.getByLabel('End date (exclusive)').fill('2026-06-03');
  await ownerPage.getByLabel('Visibility').selectOption('private');
  await ownerPage.getByRole('button', { name: 'Save' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(privateTitle) })).toBeVisible();

  await memberPage.reload();
  await expect(memberPage.getByText(privateTitle)).toHaveCount(0);

  await ownerPage.getByRole('button', { name: new RegExp(editedTitle) }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Delete' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(editedTitle) })).toHaveCount(0);

  await ownerPage.context().close();
  await memberPage.context().close();
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

  ownerPage.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Folder name');
    await dialog.accept(folderName);
  });
  await ownerPage.getByRole('button', { name: 'New folder' }).click();
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
  await expect(ownerPage.getByText(documentName).first()).toBeVisible();
  await expect(ownerPage.getByText('Version history')).toBeVisible();
  await expect(ownerPage.getByText('v1')).toBeVisible();
  await expect(ownerPage.getByText('current')).toBeVisible();
  await expect(ownerPage.getByText('text/plain')).toBeVisible();

  ownerPage.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('New name');
    await dialog.accept(renamedDocumentName);
  });
  await ownerPage.getByRole('button', { name: 'Rename' }).click();
  await expect(ownerPage.getByText(renamedDocumentName).first()).toBeVisible();

  await ownerPage.getByRole('link', { name: literalPattern(`Back to /${folderName}`) }).click();
  await expect(
    ownerPage.getByRole('link', { name: literalPattern(renamedDocumentName) }),
  ).toBeVisible();

  await ownerPage.getByRole('link', { name: literalPattern(renamedDocumentName) }).click();
  ownerPage.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete this document?');
    await dialog.accept();
  });
  await ownerPage.getByRole('button', { name: 'Delete' }).click();
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
  await expect(memberPage.getByText(teamDocumentName).first()).toBeVisible();
  await expect(memberPage.getByText('v1')).toBeVisible();

  await ownerPage.context().close();
  await memberPage.context().close();
});
