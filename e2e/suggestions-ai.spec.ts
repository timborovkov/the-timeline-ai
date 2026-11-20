import { createHmac, randomUUID } from 'node:crypto';

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  closeDb,
  getDb,
  integrations,
  integrationSelections,
  integrationWebhookDeliveries,
  rawEvents,
} from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import {
  closeEmbedQueue,
  closeSuggestionQueue,
  closeWebhookDeliveryQueue,
  getEmbedQueue,
  getSuggestionQueue,
  getWebhookDeliveryQueue,
} from '@timeline/shared/queue';
import { and, eq, sql } from 'drizzle-orm';

import { processEmbedJobForTests } from '../apps/worker/src/workers/embed.js';
import { processSuggestionJobForTests } from '../apps/worker/src/workers/suggestions.js';
import { processWebhookDeliveryJob } from '../apps/worker/src/workers/webhookDelivery.js';

import { newSignedInContext, newSignedInPage } from './helpers.js';
import { e2eTeam, e2eUsers } from './test-data.js';

// Real approval and chat pages with synthetic, workspace-scoped fixtures.
const ownerScope = () => withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id);
test.setTimeout(180_000);

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

test.afterAll(async () => {
  await Promise.all([closeEmbedQueue(), closeSuggestionQueue(), closeWebhookDeliveryQueue()]);
  await closeDb();
});

async function runQueuedEmbed(rawEventId: string) {
  const job = (await getEmbedQueue().getJobs(['waiting', 'delayed'])).find(
    (entry) => 'rawEventId' in entry.data && entry.data.rawEventId === rawEventId,
  );
  if (!job) throw new Error('Expected capture to enqueue indexing');
  return processEmbedJobForTests({ db: getDb() }, job.data);
}

test('indexes an authenticated ingest webhook without creating an approval for a pulse', async ({
  request,
}) => {
  const scope = ownerScope();
  const db = getDb();
  const webhook = await scope.ingestWebhooks.createWebhook({
    name: 'Fixture source pulse',
    eventClass: 'pulse',
  });
  const requestBody = { event: 'refresh', message: 'Fixture source inventory refreshed' };
  const unauthenticated = await request.post('/api/webhooks/ingest', { data: requestBody });
  expect(unauthenticated.status()).toBe(401);
  const deliver = () =>
    request.post('/api/webhooks/ingest', {
      data: requestBody,
      headers: { authorization: `Bearer ${webhook.plaintext}` },
    });
  const response = await deliver();
  expect(response.status()).toBe(202);
  const { rawEventId } = (await response.json()) as { rawEventId: string };
  const replay = await deliver();
  expect(await replay.json()).toMatchObject({ status: 'duplicate', rawEventId });
  await runQueuedEmbed(rawEventId);
  await expect(
    scope.timeline.searchEvents({
      query: requestBody.message,
      source: 'ingest_webhook',
      eventIds: [rawEventId],
    }),
  ).resolves.toMatchObject([{ eventId: rawEventId }]);
  const member = withTeam(db, e2eTeam.id, e2eUsers.member.id);
  await expect(member.timeline.getEvent(rawEventId)).resolves.toMatchObject({ id: rawEventId });
  const privateWebhook = await scope.ingestWebhooks.createWebhook({
    name: 'Private fixture pulse',
    eventClass: 'pulse',
    visibilityDefault: 'private',
  });
  const privateDelivery = await request.post('/api/webhooks/ingest', {
    data: { ...requestBody, message: 'Private fixture inventory' },
    headers: { authorization: `Bearer ${privateWebhook.plaintext}` },
  });
  expect(privateDelivery.status()).toBe(202);
  const privateEvent = (await privateDelivery.json()) as { rawEventId: string };
  await expect(runQueuedEmbed(privateEvent.rawEventId)).resolves.toMatchObject({ skipped: true });
  await expect(member.timeline.getEvent(privateEvent.rawEventId)).resolves.toBeNull();
  const review = (await getSuggestionQueue().getJobs(['waiting', 'delayed'])).find(
    (job) => 'rawEventId' in job.data && job.data.rawEventId === rawEventId,
  );
  if (!review) throw new Error('Expected capture to enqueue proposal review');
  await processSuggestionJobForTests({ db }, review.data);
  const pending = await scope.suggestions.listPendingSuggestions();
  expect(
    pending.some((bundle) =>
      bundle.evidence.some((evidence) => evidence.rawEventId === rawEventId),
    ),
  ).toBe(false);
});

test('routes a signed and replayed GitHub delivery through indexing and approval', async ({
  browser,
  request,
}) => {
  const db = getDb();
  const scope = ownerScope();
  const repo = `fixture/${randomUUID()}`;
  const title = 'Fix partner import keyboard navigation';
  const [integration] = await db
    .insert(integrations)
    .values({
      teamId: e2eTeam.id,
      connectedByUserId: e2eUsers.owner.id,
      provider: 'github',
      displayName: 'GitHub approval fixture',
    })
    .returning({ id: integrations.id });
  if (!integration) throw new Error('Could not seed the fixture integration');
  await db.insert(integrationSelections).values({
    integrationId: integration.id,
    selectionKind: 'github.repo',
    externalId: repo,
  });
  const task = await scope.objects.createObject({
    type: 'task',
    canonicalName: title,
    status: 'doing',
    actor: { kind: 'user', userId: e2eUsers.owner.id },
    metadata: { integration_provider: 'github', integration_external_id: `${repo}#42` },
  });
  const occurredAt = new Date().toISOString();
  const deliveryId = randomUUID();
  const body = JSON.stringify({
    action: 'closed',
    repository: { full_name: repo },
    pull_request: {
      id: 42,
      number: 42,
      title,
      state: 'closed',
      merged: true,
      merged_at: occurredAt,
      updated_at: occurredAt,
      closed_at: occurredAt,
      user: { login: 'fixture-reviewer' },
      html_url: `https://github.com/${repo}/pull/42`,
      base: { ref: 'main' },
      head: { ref: 'keyboard' },
    },
  });
  const headers = {
    'content-type': 'application/json',
    'x-github-event': 'pull_request',
    'x-github-delivery': deliveryId,
  };
  const rejected = await request.post('/api/webhooks/github', {
    data: body,
    headers: { ...headers, 'x-hub-signature-256': 'sha256=invalid' },
  });
  expect(await rejected.json()).toMatchObject({ reason: 'bad_signature' });
  const signature = createHmac('sha256', 'e2e-github-webhook-signing-secret')
    .update(body)
    .digest('hex');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const delivered = await request.post('/api/webhooks/github', {
      data: body,
      headers: { ...headers, 'x-hub-signature-256': `sha256=${signature}` },
    });
    expect(await delivered.json()).toEqual({ ok: true });
  }
  const deliveries = await db
    .select({ id: integrationWebhookDeliveries.id })
    .from(integrationWebhookDeliveries)
    .where(eq(integrationWebhookDeliveries.externalDeliveryId, deliveryId));
  expect(deliveries).toHaveLength(1);
  const delivery = (await getWebhookDeliveryQueue().getJobs(['waiting', 'delayed'])).find(
    (job) => job.data.deliveryId === deliveries[0]?.id,
  );
  if (!delivery) throw new Error('Expected GitHub to enqueue delivery normalization');
  await expect(processWebhookDeliveryJob({ db }, delivery.data)).resolves.toMatchObject({
    processed: 1,
  });
  await expect(processWebhookDeliveryJob({ db }, delivery.data)).resolves.toMatchObject({
    skipped: true,
  });
  const captured = await db
    .select()
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, e2eTeam.id),
        sql`${rawEvents.sourceMetadata}->>'external_object_id' = ${`${repo}#42`}`,
      ),
    );
  expect(captured).toHaveLength(1);
  const event = captured[0]!;
  await runQueuedEmbed(event.id);
  await expect(
    scope.timeline.searchEvents({ query: event.contentText ?? title, eventIds: [event.id] }),
  ).resolves.toMatchObject([{ eventId: event.id }]);
  await expect(
    withTeam(db, e2eTeam.id, e2eUsers.nonMember.id).timeline.getEvent(event.id),
  ).rejects.toThrow();
  const proposalJob = (await getSuggestionQueue().getJobs(['waiting', 'delayed'])).find(
    (job) =>
      'scope' in job.data &&
      job.data.scope === 'github_task_proposal' &&
      job.data.externalObjectId === `${repo}#42`,
  );
  if (!proposalJob) throw new Error('Expected GitHub to enqueue coalesced proposal review');
  await processSuggestionJobForTests({ db }, proposalJob.data);
  await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({ status: 'doing' });
  const visible = await scope.suggestions.listPendingSuggestions();
  const proposed = visible
    .flatMap((bundle) => bundle.items)
    .filter((item) => item.targetId === task.id);
  expect(proposed).toHaveLength(1);
  expect(proposed[0]?.proposedPayload.status).toBe('done');

  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.goto('/app/approvals');
    await page
      .getByRole('button', { name: new RegExp(title, 'i') })
      .first()
      .click();
    await page
      .getByRole('region', { name: 'Review proposal' })
      .getByRole('button', { name: 'Accept', exact: true })
      .click();
    await expect.poll(async () => (await scope.objects.getObject(task.id))?.status).toBe('done');
  } finally {
    await page.context().close();
  }
});

test('reviews the exact stale evidence and rejects with a reason', async ({ browser }, info) => {
  const db = getDb();
  const sourceId = randomUUID();
  const savedQuote = 'The partner review is Friday at 10:00.';
  const revisedQuote = 'The partner review moved to Monday at 14:00.';
  const title = 'Prepare notes for the partner review';
  await db.insert(rawEvents).values({
    id: sourceId,
    teamId: e2eTeam.id,
    authorUserId: e2eUsers.owner.id,
    source: 'calendar',
    contentText: savedQuote,
    occurredAt: new Date('2026-11-19T10:00:00Z'),
    visibility: 'team',
  });
  const bundle = await ownerScope().suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title,
    dedupeKey: sourceId,
    metadata: { evidence_pack_fingerprint: 'a'.repeat(64) },
    evidence: [{ rawEventId: sourceId, quote: savedQuote }],
    items: [
      {
        operation: 'create',
        targetKind: 'task',
        title,
        dedupeKey: sourceId,
        proposedPayload: { canonicalName: title },
        evidenceRawEventIds: [sourceId],
      },
    ],
  });
  await db.update(rawEvents).set({ contentText: revisedQuote }).where(eq(rawEvents.id, sourceId));

  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.goto('/app/approvals');
    await page
      .getByRole('button', { name: new RegExp(title, 'i') })
      .first()
      .click();
    const preview = page.getByRole('region', { name: 'Review proposal' });
    await expect(preview.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
    await preview.getByRole('button', { name: 'Inspect changes' }).click();
    await expect(preview.getByText(revisedQuote)).toBeVisible();
    await expect(preview.getByText('Saved quote', { exact: true })).toBeVisible();
    await screenshot(page, info, 'stale-evidence-comparison');

    await preview.getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByLabel('Rejection reason (optional)').selectOption('insufficient_evidence');
    await screenshot(page, info, 'approval-rejection-reason');
    await page.getByRole('button', { name: 'Reject proposal', exact: true }).click();
    const itemId = bundle.items[0]?.id;
    await expect
      .poll(async () => {
        const rejected = await ownerScope().suggestions.listSuggestions({ status: 'resolved' });
        return rejected.flatMap((row) => row.items).find((item) => item.id === itemId)?.metadata
          .rejection_reason;
      })
      .toBe('insufficient_evidence');
  } finally {
    await page.context().close();
  }
});

test('shows coverage, diagnostics and an interrupted workflow on reload', async ({
  browser,
}, info) => {
  const scope = ownerScope();
  await scope.diagnostics.configure(true);
  const session = await scope.objects.createChatSession();
  const id = randomUUID();
  const assistantMessage = {
    id,
    role: 'assistant' as const,
    metadata: {
      answerEvidence: [
        {
          source: 'slack',
          status: 'queried',
          latest: { date: '2026-11-18T11:00:00Z', basis: 'source', version: null, citation: null },
        },
        {
          source: 'documents',
          status: 'indexing',
          latest: { date: '2026-11-19T10:00:00Z', basis: 'uploaded', version: 4, citation: null },
        },
        { source: 'email', status: 'unavailable', latest: null },
      ],
    },
    parts: [
      {
        type: 'text' as const,
        text: 'Slack records a Friday delivery. The planning document still lists Monday. The delivery-date change is awaiting approval.',
      },
      {
        type: 'tool-execute_board_create' as const,
        toolCallId: 'workflow-board',
        input: {
          name: 'Partner rollout',
          templateKind: 'pipeline',
          reason: 'Requested by reviewer',
        },
        state: 'approval-requested' as const,
        approval: { id: 'workflow-approval' },
      },
    ],
  };
  await scope.objects.persistChatTurn(session.id, {
    userMessage: {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: 'What is the partner rollout plan?' }],
    },
    assistantMessage,
  });
  await scope.objects.claimChatApprovals(session.id, {
    ...assistantMessage,
    parts: [
      assistantMessage.parts[0]!,
      {
        ...assistantMessage.parts[1]!,
        type: 'tool-execute_board_create',
        toolCallId: 'workflow-board',
        state: 'approval-responded',
        approval: { id: 'workflow-approval', approved: true },
      },
    ],
  });
  const desktop = await newSignedInPage(browser, 'owner');
  try {
    await desktop.goto(`/app/chat?session=${session.id}`);
    await desktop.getByText('Sources checked · partial coverage', { exact: true }).click();
    await expect(desktop.getByText('Still indexing', { exact: false })).toBeVisible();
    await expect(desktop.getByText('Document v4', { exact: false })).toBeVisible();
    await screenshot(desktop, info, 'answer-source-coverage');
    await desktop.getByRole('link', { name: 'Report an issue' }).click();
    await desktop
      .getByLabel('Issue with the answer (optional)')
      .selectOption('wrong_document_version');
    await screenshot(desktop, info, 'answer-quality-feedback');
  } finally {
    await desktop.context().close();
  }
  const mobile = await newSignedInContext(browser, 'owner', {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await mobile.newPage();
    await page.goto(`/app/chat?session=${session.id}`);
    // Visible label is aria-hidden; the accessible name lives in the sr-only twin.
    await expect(
      page.getByText('Create board: Partner rollout: Approved · step did not start'),
    ).toBeVisible();
    await screenshot(page, info, 'chat-recovery-mobile');
    await page.getByRole('button', { name: 'Review unstarted steps' }).click();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  } finally {
    await mobile.close();
  }
});
