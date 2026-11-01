import { expect, test } from '@playwright/test';
import { closeDb, getDbClient } from '@timeline/db';
import { PRIVACY_VERSION } from '@timeline/shared/legal-versions';

import { newSignedInPage, signInFromCurrentPage, waitForPost } from './helpers.js';
import { e2eTeam, e2eUsers } from './test-data.js';

test.afterAll(async () => closeDb());

test('accepting updated legal documents refreshes the session and clears the loading toast', async ({
  page,
}) => {
  const sql = getDbClient();
  await sql`UPDATE users SET legal_privacy_version = '2026-08-21' WHERE id = ${e2eUsers.member.id}`;
  try {
    await page.goto('/sign-in');
    await signInFromCurrentPage(page, e2eUsers.member.email, /\/(?:app|legal\/accept)(?:\?|$)/);
    await expect(page).toHaveURL(/\/legal\/accept/);
    await expect(page.getByRole('heading', { name: 'Review The Timeline terms' })).toBeVisible();
    await page.getByRole('checkbox').check();
    await waitForPost(page, new URL(page.url()).pathname, async () => {
      await page.getByRole('button', { name: 'Accept and continue' }).click();
    });
    await expect(page.getByRole('button', { name: 'Accept and continue' })).not.toBeVisible();
    await expect(page).toHaveURL(/\/app(?:\?|$)/, { timeout: 30_000 });
    await expect(page.getByText('Saving changes…', { exact: true })).not.toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/app(?:\?|$)/);
    const [user] =
      await sql`SELECT legal_privacy_version FROM users WHERE id = ${e2eUsers.member.id}`;
    expect(user?.legal_privacy_version).toBe(PRIVACY_VERSION);
  } finally {
    await sql`UPDATE users SET legal_privacy_version = ${PRIVACY_VERSION} WHERE id = ${e2eUsers.member.id}`;
  }
});

test('saving the email whitelist clears loading and preserves the success toast', async ({
  browser,
}) => {
  const sql = getDbClient();
  const [original] =
    await sql`SELECT inbound_sender_whitelist, inbound_sender_whitelist_enabled FROM teams WHERE id = ${e2eTeam.id}`;
  if (!original) throw new Error('Missing synthetic team');
  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.goto('/app/team?section=email');
    const form = page.locator('form').filter({ hasText: 'Additional allowed senders' });
    await form.getByLabel('Additional allowed senders').fill('toast-feedback@example.test');
    await waitForPost(page, '/app/team', async () => {
      await form.getByRole('button', { name: 'Save email settings' }).click();
    });
    await expect(page.getByText('Email settings updated', { exact: true })).toBeVisible();
    await expect(page.getByText('Saving changes…', { exact: true })).not.toBeVisible();
    await expect(form.getByRole('button', { name: 'Save email settings' })).toBeEnabled();
    await page.reload();
    await expect(page.getByLabel('Additional allowed senders')).toHaveValue(
      'toast-feedback@example.test',
    );
    await expect(page.getByText('Saving changes…', { exact: true })).not.toBeVisible();
  } finally {
    await sql`UPDATE teams SET inbound_sender_whitelist = ${JSON.stringify(original.inbound_sender_whitelist)}::jsonb,
      inbound_sender_whitelist_enabled = ${original.inbound_sender_whitelist_enabled} WHERE id = ${e2eTeam.id}`;
    await page.context().close();
  }
});
