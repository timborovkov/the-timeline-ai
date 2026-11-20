import { randomUUID } from 'node:crypto';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { withE2eDataTransaction } from './cleanup.js';
import { newSignedInPage } from './helpers.js';
import { e2eOtherTeam, e2eSeedTasks, e2eTeam, e2eUsers } from './test-data.js';

test.describe.configure({ timeout: 180_000 });

async function screenshot(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = info.outputPath(name + '.png');
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('workspace dates, scoped keyword matches and date recovery', async ({ browser }, info) => {
  const eventId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const calendarId = randomUUID();
  const allDayId = randomUUID();
  const matchingTaskId = randomUUID();
  const oldTaskId = randomUUID();
  const privateEventId = randomUUID();
  const outsiderEventId = randomUUID();
  await withE2eDataTransaction(async (sql) => {
    await sql`
      INSERT INTO team_calendar_settings (team_id, default_timezone)
      VALUES (${e2eTeam.id}, 'Europe/Helsinki')
      ON CONFLICT (team_id) DO UPDATE SET default_timezone = EXCLUDED.default_timezone
    `;
    await sql`
      INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, occurred_at, visibility)
      VALUES
        (${eventId}, ${e2eTeam.id}, ${e2eUsers.owner.id}, 'web', 'Q4 launch notes', '2026-03-28T22:30:00Z', 'team'),
        (${privateEventId}, ${e2eTeam.id}, ${e2eUsers.member.id}, 'web', 'Q4 private notes', '2026-03-28T22:30:00Z', 'private'),
        (${outsiderEventId}, ${e2eOtherTeam.id}, ${e2eUsers.nonMember.id}, 'web', 'Q4 other workspace', '2026-03-28T22:30:00Z', 'team')
    `;
    await sql`
      INSERT INTO documents (id, team_id, name)
      VALUES (${documentId}, ${e2eTeam.id}, 'Release checklist')
    `;
    await sql`
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, created_at)
      VALUES (${versionId}, ${e2eTeam.id}, ${documentId}, 1, 'fixtures/Q4-checklist.txt', 240, '2026-03-28T22:30:00Z')
    `;
    await sql`UPDATE documents SET current_version_id = ${versionId} WHERE id = ${documentId}`;
    await sql`
      INSERT INTO calendar_events (id, team_id, created_by_user_id, title, start_at, end_at, timezone, all_day)
      VALUES
        (${calendarId}, ${e2eTeam.id}, ${e2eUsers.owner.id}, 'Q4 handoff', '2026-03-28T22:30:00Z', '2026-03-28T23:00:00Z', 'UTC', false),
        (${allDayId}, ${e2eTeam.id}, ${e2eUsers.owner.id}, 'Q4 next-day workshop', '2026-03-29T18:30:00Z', '2026-03-30T18:30:00Z', '+0530', true)
    `;
    await sql`
      INSERT INTO entities (id, team_id, type, canonical_name, status, updated_at)
      VALUES
        (${matchingTaskId}, ${e2eTeam.id}, 'task', 'Q4 checklist review', 'backlog', '2026-03-28T22:45:00Z'),
        (${oldTaskId}, ${e2eTeam.id}, 'task', 'Q4 build archive', 'backlog', '2026-03-28T21:59:59Z')
    `;
  });

  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const search = await page.request.post('/api/search/global', {
      data: { query: 'Q4', mode: 'full', source: 'web', from: '2026-03-29', to: '2026-03-29' },
      timeout: 120_000,
    });
    expect(search.ok()).toBe(true);
    await search.dispose();
    await page.goto('/app/search?q=Q4&source=web&from=2026-03-29&to=2026-03-29');
    await expect(page.getByRole('link', { name: 'Q4 launch notes', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Release checklist', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Q4 checklist review', exact: true }),
    ).toBeVisible();
    for (const title of [
      'Q4 build archive',
      'Q4 private notes',
      'Q4 other workspace',
      'Q4 next-day workshop',
    ]) {
      await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    }
    const calendar = page.getByRole('link', { name: 'Q4 handoff', exact: true });
    await expect(calendar).toHaveAttribute(
      'href',
      '/app/calendar?date=2026-03-29&view=day&event=' + calendarId,
    );
    await expect(page.getByText(/Keyword matches only in Timeline, Documents/)).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('button', { name: 'Timeline source', exact: true })).toBeVisible();
    await screenshot(page, info, 'search-filter-scope-and-keyword-coverage');
    await page.keyboard.press('Escape');
    await calendar.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.goto('/app/search?q=Q4&source=web&from=2026-02-30');
    await expect(page.getByText('Enter a valid start date.')).toBeVisible();
    await screenshot(page, info, 'search-invalid-date-recovery');
    await page.getByRole('button', { name: 'Clear start date' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search everything' })).toHaveValue('Q4');
    await expect(page.getByRole('link', { name: 'Q4 launch notes', exact: true })).toBeVisible();
  } finally {
    await page.context().close();
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM raw_events WHERE id IN (${eventId}, ${privateEventId}, ${outsiderEventId})`;
      await sql`DELETE FROM documents WHERE id = ${documentId}`;
      await sql`DELETE FROM calendar_events WHERE id IN (${calendarId}, ${allDayId})`;
      await sql`DELETE FROM entities WHERE id IN (${matchingTaskId}, ${oldTaskId})`;
    });
  }
});

test('capture reports saved parts and retries only the failed file', async ({ browser }, info) => {
  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const upload = /capture-notes\.txt/;
    await page.route(upload, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/app');
    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Capture a moment' });
    await dialog
      .getByRole('textbox', { name: 'Note' })
      .fill('Release handoff from the design team.');
    await dialog.getByLabel('Attach files').setInputFiles([
      {
        name: 'capture-overview.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Release overview'),
      },
      { name: 'capture-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Release notes') },
    ]);
    await dialog.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'Saved' })).toContainText(
      'capture-overview.txt',
    );
    await expect(dialog.getByRole('alert')).toContainText('capture-notes.txt');
    await screenshot(page, info, 'capture-partial-save');
    await page.unroute(upload);
    await dialog.getByRole('button', { name: 'Retry failed files' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'Saved' })).toContainText(
      'capture-notes.txt',
    );
    await expect(dialog.getByText('Couldn’t save', { exact: true })).toHaveCount(0);
    await screenshot(page, info, 'capture-files-retried');
  } finally {
    await page.context().close();
  }
});

test('Inbox opens the item while the read update fails', async ({ browser }, info) => {
  const id = randomUUID();
  const taskId = e2eSeedTasks.mobileKanban.id;
  const updateUrl = '**/api/inbox/' + id + '/read';
  const failedRead = Promise.withResolvers<void>();
  await withE2eDataTransaction(async (sql) => {
    await sql`
      INSERT INTO notifications (id, team_id, user_id, kind, entity_id, summary)
      VALUES (${id}, ${e2eTeam.id}, ${e2eUsers.owner.id}, 'object_changed', ${taskId}, 'The release checklist changed')
    `;
  });
  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/app');
    await page.getByRole('button', { name: /Open inbox, .* unread/ }).click();
    const item = page.getByRole('link', { name: /The release checklist changed/ });
    await expect(item).toBeVisible();
    await page.route(updateUrl, async (route) => {
      await failedRead.promise;
      await route.fulfill({ status: 503 });
    });
    await Promise.all([page.waitForRequest(updateUrl), item.click()]);
    await expect(page).toHaveURL(new RegExp('/app/objects/' + taskId + '$'));
    await expect(
      page.getByRole('heading', { name: e2eSeedTasks.mobileKanban.canonicalName }),
    ).toBeVisible();
    const response = page.waitForResponse(updateUrl);
    failedRead.resolve();
    expect((await response).status()).toBe(503);
    await expect(page.getByRole('button', { name: /Open inbox, .* unread/ })).toBeVisible();
    await screenshot(page, info, 'inbox-opened-with-read-update-failure');

    await page.unroute(updateUrl);
    await page.getByRole('button', { name: /Open inbox, .* unread/ }).click();
    const read = page.waitForResponse(updateUrl);
    await item.click();
    expect((await read).status()).toBe(204);
    await withE2eDataTransaction(async (sql) => {
      const [notification] = await sql<{ read_at: Date | null }[]>`
        SELECT read_at FROM notifications WHERE id = ${id}
      `;
      expect(notification?.read_at).toBeTruthy();
    });
  } finally {
    failedRead.resolve();
    await page.context().close();
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM notifications WHERE id = ${id}`;
    });
  }
});

test('expired and revoked invitations offer the same recovery to signed-out visitors', async ({
  page,
}, info) => {
  const [expired, revoked] = [randomUUID(), randomUUID()];
  const email = 'invitation-recipient@example.test';
  await withE2eDataTransaction(async (sql) => {
    await sql`
      INSERT INTO team_invites (team_id, email, token, invited_by_user_id, expires_at, revoked_at)
      VALUES
        (${e2eTeam.id}, ${email}, ${expired}, ${e2eUsers.owner.id}, NOW() - INTERVAL '1 day', NULL),
        (${e2eTeam.id}, ${email}, ${revoked}, ${e2eUsers.owner.id}, NOW() + INTERVAL '1 day', NOW())
    `;
  });
  try {
    for (const token of [expired, revoked]) {
      await page.goto('/accept-invite/' + token);
      await expect(page.getByRole('heading', { name: 'Invite invalid' })).toBeVisible();
      await expect(
        page.getByText('Ask the person who invited you for a fresh link.'),
      ).toBeVisible();
      await expect(page.getByText(email)).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Sign up' })).toHaveCount(0);
    }
    await screenshot(page, info, 'invite-recovery');
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM team_invites WHERE token IN (${expired}, ${revoked})`;
    });
  }
});

test('first-run capture can be resumed from Home before and after completion', async ({
  browser,
}, info) => {
  const documentId = randomUUID();
  const versionId = randomUUID();
  const eventId = randomUUID();
  await withE2eDataTransaction(async (sql) => {
    await sql`
      INSERT INTO raw_events (id, team_id, author_user_id, source, content_text)
      VALUES (${eventId}, ${e2eTeam.id}, ${e2eUsers.owner.id}, 'document', 'Uploaded Launch plan.pdf')
    `;
    await sql`
      INSERT INTO documents (id, team_id, name) VALUES (${documentId}, ${e2eTeam.id}, 'Launch plan.pdf')
    `;
    await sql`
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, source_event_id)
      VALUES (${versionId}, ${e2eTeam.id}, ${documentId}, 1, 'fixtures/launch-plan.pdf', 340, ${eventId})
    `;
    await sql`UPDATE documents SET current_version_id = ${versionId} WHERE id = ${documentId}`;
    await sql`
      INSERT INTO team_first_run (team_id, started_by_user_id, phase, starter_path, starter_selected_at, capture_document_id)
      VALUES (${e2eTeam.id}, ${e2eUsers.owner.id}, 'processing', 'document', NOW(), ${documentId})
    `;
  });

  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Reading Launch plan.pdf' })).toBeVisible();
    await expect(page.getByText('Queued for extraction.')).toBeVisible();
    await expect(page.getByText('Done', { exact: true })).toBeVisible();
    const statusUrl = page.url();
    expect(statusUrl).toContain('?capture=');
    await screenshot(page, info, 'first-run-capture-progress');

    await page.getByRole('link', { name: 'Go to Home' }).click();
    const resume = page.getByRole('link', { name: 'View capture status' });
    await expect(resume).toBeVisible();
    await screenshot(page, info, 'first-run-resume-from-home');
    await resume.click();
    await expect(page).toHaveURL(statusUrl);

    await page.getByRole('link', { name: 'Go to Home' }).click();
    await expect(resume).toBeVisible();
    await withE2eDataTransaction(async (sql) => {
      await sql`
        INSERT INTO document_chunks (team_id, document_id, document_version_id, chunk_index, text, token_count)
        VALUES (${e2eTeam.id}, ${documentId}, ${versionId}, 0, 'The launch plan sets the release date and assigns review owners.', 12)
      `;
      await sql`UPDATE document_versions SET processing_status = 'embedded' WHERE id = ${versionId}`;
    });
    // Home advances first-run to `record` and GUIDED_SHELL_PHASES redirects into the
    // guided record with the same ?capture= key — there is no ready banner on Home.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/onboarding\/record\?capture=/);
    await expect(page.getByRole('heading', { name: 'Launch plan.pdf' })).toBeVisible();
    await expect(
      page.getByText('The launch plan sets the release date and assigns review owners.'),
    ).toBeVisible();
    await screenshot(page, info, 'first-run-guided-record');

    await withE2eDataTransaction(async (sql) => {
      await sql`UPDATE team_first_run SET phase = 'complete' WHERE team_id = ${e2eTeam.id}`;
    });
    await page.goto(statusUrl);
    await expect(page.getByRole('heading', { name: 'Launch plan.pdf' })).toBeVisible();

    await withE2eDataTransaction(async (sql) => {
      await sql`UPDATE team_first_run SET starter_selected_at = NOW() WHERE team_id = ${e2eTeam.id}`;
    });
    await page.goto(statusUrl);
    await expect(page.getByRole('heading', { name: 'Capture unavailable' })).toBeVisible();
  } finally {
    await page.context().close();
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM team_first_run WHERE team_id = ${e2eTeam.id}`;
      await sql`DELETE FROM documents WHERE id = ${documentId}`;
      await sql`DELETE FROM raw_events WHERE id = ${eventId}`;
    });
  }
});
