// Exercise workspace recovery and follow-through through the signed-in product UI.
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { withE2eDataTransaction } from './cleanup.js';
import { newSignedInContext } from './helpers.js';
import { e2eTeam, e2eUsers } from './test-data.js';

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

const ownerId = e2eUsers.owner.id;
const teamId = e2eTeam.id;

test('meeting capture distinguishes recoverable recorder failure from an empty transcript', async ({
  browser,
}, testInfo) => {
  const failed = crypto.randomUUID();
  const empty = crypto.randomUUID();
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO meetings (id, team_id, created_by_user_id, platform, meeting_url, title, status, created_at)
      VALUES (${failed}, ${teamId}, ${ownerId}, 'meet', 'https://meet.google.com/test-room', 'Northstar check-in', 'failed', now() - interval '1 day'),
             (${empty}, ${teamId}, ${ownerId}, 'meet', 'https://meet.google.com/test-room', 'Launch recap', 'completed', now() - interval '1 day')`;
    await sql`INSERT INTO meeting_transcript_chunks (meeting_id, team_id, speaker, text, start_ms, end_ms)
      VALUES (${failed}, ${teamId}, 'Jordan', 'The launch checklist is ready for review.', 0, 2200)`;
  });
  const context = await newSignedInContext(browser, 'owner', {
    viewport: { width: 1440, height: 960 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`/app/meetings/${failed}`);
    await expect(page.getByRole('region', { name: 'Capture recovery' })).toContainText(
      'Recorder failed',
    );
    await expect(page.getByRole('button', { name: 'Retry processing' })).toBeVisible();
    await screenshot(page, testInfo, 'meeting-recovery');
    await page.getByRole('button', { name: 'Retry processing' }).click();
    await expect(page.getByText('Processing', { exact: true })).toBeVisible();
    await page.goto(`/app/meetings/${empty}`);
    await expect(page.getByRole('region', { name: 'Capture recovery' })).toContainText(
      'Capture completed with no transcript',
    );
    await expect(page.getByRole('link', { name: 'Open Meetings' })).toBeVisible();
    await screenshot(page, testInfo, 'meeting-empty-transcript');
  } finally {
    await context.close();
  }
});

test('calendar import displays sync state and organizers can block opted-in reminders', async ({
  browser,
}, testInfo) => {
  const eventId = crypto.randomUUID();
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO google_calendar_imports (team_id, user_id, ciphertext, iv, tag, calendar_id, calendar_name, last_sync_at, next_sync_at)
      VALUES (${teamId}, ${ownerId}, decode('', 'hex'), decode('', 'hex'), decode('', 'hex'), 'calendar-fixture', 'Northstar planning', now(), now() + interval '1 day')`;
    await sql`INSERT INTO calendar_events (id, team_id, created_by_user_id, title, start_at, end_at)
      VALUES (${eventId}, ${teamId}, ${ownerId}, 'Northstar launch review', now() + interval '1 hour', now() + interval '2 hours')`;
  });
  const context = await newSignedInContext(browser, 'owner', {
    viewport: { width: 1440, height: 1200 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/app/calendar');
    const section = page.getByRole('region', { name: 'Google Calendar import' });
    await expect(section).toContainText('Northstar planning');
    await expect(section).toContainText('Last synced');
    await section.scrollIntoViewIfNeeded();
    await screenshot(page, testInfo, 'google-calendar-import');
    await page.goto(`/app/calendar?event=${eventId}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit event' })).toBeVisible();
    await dialog.getByText('Reminders', { exact: true }).click();
    await expect(dialog.getByLabel('My reminder')).toHaveValue('');
    await dialog.getByLabel('My reminder').selectOption('15');
    await expect(dialog.getByLabel('My reminder')).toHaveValue('15');
    await dialog.getByRole('button', { name: 'Block reminders for everyone' }).click();
    await expect(
      dialog.getByText('Reminders are blocked for everyone for this event.'),
    ).toBeVisible();
    await screenshot(page, testInfo, 'event-reminders');
  } finally {
    await context.close();
  }
});

test('source health, captured-file triage, and OCR deferral expose recovery controls', async ({
  browser,
}, testInfo) => {
  const integrationId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO integrations (id, team_id, connected_by_user_id, provider, display_name, last_synced_at)
      VALUES (${integrationId}, ${teamId}, ${ownerId}, 'github', 'Northstar engineering', now() - interval '30 minutes')`;
    await sql`INSERT INTO integration_selections (integration_id, selection_kind, external_id, external_label)
      VALUES (${integrationId}, 'repository', 'test-repo', 'northstar/ship')`;
    await sql`INSERT INTO raw_events (id, team_id, source, content_text, source_metadata)
      VALUES (${sourceId}, ${teamId}, 'slack', 'Jordan shared the launch scan.',
        jsonb_build_object('source', 'slack', 'sender_name', 'Jordan', 'integration_id', ${integrationId}::text))`;
    await sql`INSERT INTO documents (id, team_id, file_kind, name, owner_user_id, source_raw_event_id)
      VALUES (${documentId}, ${teamId}, 'captured', 'Launch checklist scan.pdf', ${ownerId}, ${sourceId})`;
    await sql`INSERT INTO document_versions (id, team_id, document_id, version, object_key, content_type, source_event_id, processing_status, processing_error)
      VALUES (${versionId}, ${teamId}, ${documentId}, 1, ${'fixture/launch-checklist.pdf'}, 'application/pdf', ${sourceId}, 'deferred', 'vision_budget_deferred')`;
    await sql`UPDATE documents SET current_version_id = ${versionId} WHERE id = ${documentId}`;
    await sql`INSERT INTO document_extraction_attempts (team_id, version_id, requested_by, status, representations, model)
      VALUES (${teamId}, ${versionId}, ${ownerId}, 'ready', '[{"kind":"source_text","text":"Launch readiness review moved to Friday."}]'::jsonb, 'fixture')`;
  });
  const context = await newSignedInContext(browser, 'owner', {
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/app/connections/health');
    await expect(page.getByRole('heading', { name: 'Source health' })).toBeVisible();
    await expect(page.getByText('northstar/ship')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Queue reindex' }).first()).toBeVisible();
    await screenshot(page, testInfo, 'source-health');
    await page.goto('/app/documents/captured?source=slack&sender=Jordan');
    await expect(page.getByText('Launch checklist scan.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText('Deferred by OCR budget', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select Launch checklist scan.pdf' }).check();
    await expect(page.getByRole('button', { name: 'Re-extract selected' })).toBeVisible();
    await screenshot(page, testInfo, 'captured-file-triage');
    await page.getByRole('link', { name: 'Extraction history' }).click();
    await expect(page.getByRole('button', { name: 'Apply extraction' })).toBeVisible();
    await page.getByText('source text', { exact: true }).click();
    await expect(page.getByText('Launch readiness review moved to Friday.')).toBeVisible();
    await screenshot(page, testInfo, 'file-extraction-history');
    await page.goto('/app/team/ocr');
    await expect(page.getByRole('heading', { name: 'OCR budget' })).toBeVisible();
    await page.getByLabel('Monthly OCR limit (USD)').fill('0');
    await page.getByRole('button', { name: 'Save budget' }).click();
    await expect
      .poll(async () => {
        let configured: number | null = null;
        await withE2eDataTransaction(async (sql) => {
          const [row] =
            await sql`SELECT vision_budget_cents FROM team_billing_accounts WHERE team_id = ${teamId}`;
          configured = row?.vision_budget_cents ?? null;
        });
        return configured;
      })
      .toBe(0);
    await screenshot(page, testInfo, 'ocr-budget');
  } finally {
    await context.close();
  }
});

test('saves a cited project handoff and a personal approval view', async ({
  browser,
}, testInfo) => {
  const projectId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO entities (id, team_id, type, canonical_name, status)
      VALUES (${projectId}, ${teamId}, 'project', 'Northstar launch', 'open')`;
    await sql`INSERT INTO raw_events (id, team_id, source, content_text)
      VALUES (${sourceId}, ${teamId}, 'web', 'Legal review is still open for the launch.')`;
    await sql`INSERT INTO chat_sessions (id, team_id, created_by, pinned_entity_id, title)
      VALUES (${sessionId}, ${teamId}, ${ownerId}, ${projectId}, 'Northstar launch handoff')`;
    const answer = `Legal review is still open for the launch. [ev:${sourceId}]`;
    await sql`INSERT INTO chat_messages (team_id, session_id, role, content)
      VALUES (${teamId}, ${sessionId}, 'assistant', ${sql.json({
        version: 2,
        text: answer,
        ui_message: { id: messageId, role: 'assistant', parts: [{ type: 'text', text: answer }] },
        handoff_provenance: [{ kind: 'timeline_event', id: sourceId }],
      })})`;
  });
  const context = await newSignedInContext(browser, 'owner', {
    viewport: { width: 1440, height: 1000 },
  });
  const memberContext = await newSignedInContext(browser, 'member', {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(`/app/chat?session=${sessionId}`);
    await page.getByRole('button', { name: 'Save handoff' }).click();
    await expect(page).toHaveURL(/\/app\/handoffs\//);
    await expect(page.getByRole('link', { name: 'Open current project' })).toHaveAttribute(
      'href',
      `/app/objects/${projectId}`,
    );
    await screenshot(page, testInfo, 'project-handoff');
    const member = await memberContext.newPage();
    const snapshotPath = new URL(page.url()).pathname;
    await member.goto(snapshotPath);
    await expect(member.getByRole('heading', { name: 'Northstar launch handoff' })).toBeVisible();
    await screenshot(member, testInfo, 'project-handoff-mobile');
    await withE2eDataTransaction(async (sql) => {
      await sql`UPDATE raw_events SET visibility = 'private', visibility_owner_user_id = ${ownerId} WHERE id = ${sourceId}`;
    });
    await member.reload();
    await expect(member.getByText('Legal review is still open for the launch.')).not.toBeVisible();
    await page.goto(`/app/approvals?status=pending&project=${projectId}&decision=1`);
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save view' });
    await screenshot(page, testInfo, 'save-approval-view');
    await dialog.getByLabel('View name').fill('Northstar decisions awaiting approval');
    await dialog.getByRole('button', { name: 'Save view' }).click();
    await expect(dialog).not.toBeVisible();
    await page.goto('/app/work/views');
    await expect(
      page.getByRole('link', { name: 'Northstar decisions awaiting approval' }),
    ).toHaveAttribute('href', /project=.*decision=1/);
    const optIn = page.getByRole('checkbox', { name: 'Include new matches in my digest' });
    await expect(optIn).not.toBeChecked();
    await optIn.check();
    await expect(optIn).toBeChecked();
    await screenshot(page, testInfo, 'saved-view-digest');
  } finally {
    await Promise.all([context.close(), memberContext.close()]);
  }
});
