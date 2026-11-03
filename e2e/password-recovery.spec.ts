import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { closeDb, getDbClient } from '@timeline/db';
import { decryptJson } from '@timeline/shared/crypto';
import { TERMS_VERSION, PRIVACY_VERSION } from '@timeline/shared/legal-versions';
import { hashPassword } from '@timeline/shared/passwords';

import { e2eTeam } from './test-data.js';

test.afterAll(async () => closeDb());

test('password recovery replaces credentials and revokes both browser sessions', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const sql = getDbClient();
  const userId = randomUUID();
  const email = `recovery-${userId}@example.test`;
  const oldPassword = 'Original-recovery-password';
  const newPassword = 'Replacement-recovery-password';
  const hash = await hashPassword(oldPassword);
  await sql`INSERT INTO users (id, email, name, password_hash, legal_terms_version, legal_privacy_version, legal_accepted_at)
    VALUES (${userId}, ${email}, 'Recovery test', ${hash}, ${TERMS_VERSION}, ${PRIVACY_VERSION}, now())`;
  await sql`INSERT INTO team_members (team_id, user_id, role) VALUES (${e2eTeam.id}, ${userId}, 'member')`;
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const second = await other.newPage();
  try {
    for (const signedInPage of [page, second]) {
      await signedInPage.goto('/sign-in');
      await signedInPage.getByLabel('Email').fill(email);
      await signedInPage.getByLabel('Password', { exact: true }).fill(oldPassword);
      await signedInPage.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(signedInPage).toHaveURL(/\/app(?:\?|$)/);
    }
    // Recovery remains available to a signed-in user as well as signed-out users.
    const response = await page.goto('/forgot-password');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await page.getByLabel('Email').fill(email.toUpperCase());
    await page.getByLabel('Email').press('Tab');
    await page.getByRole('button', { name: 'Send reset link' }).press('Enter');
    await expect(page.getByRole('status')).toContainText('If an account');
    // Capture the actual rendered outgoing email from its encrypted delivery record.
    // The E2E environment uses a fake Resend key, so no live mail is sent.
    const [delivery] =
      await sql`SELECT metadata FROM message_deliveries WHERE user_id = ${userId} AND intent = 'password_reset' ORDER BY created_at DESC LIMIT 1`;
    const encrypted = delivery!.metadata.email_payload_encrypted;
    const payload = decryptJson({
      ciphertext: Buffer.from(encrypted.ciphertext, 'base64'),
      iv: Buffer.from(encrypted.iv, 'base64'),
      tag: Buffer.from(encrypted.tag, 'base64'),
    }) as { text: string };
    const link = payload.text.match(/Reset password: (\S+)/)?.[1];
    expect(link).toBeTruthy();
    await page.goto(link!);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('all previous sessions');
    expect(await (await second.request.get('/api/auth/session')).json()).toBeNull();
    await second.goto('/app');
    await expect(second).toHaveURL(/\/sign-in/);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Invalid email or password' }),
    ).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/app(?:\?|$)/);
    await page.goto(link!);
    await expect(
      page.getByRole('alert').filter({ hasText: 'invalid or has already been used' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request a new reset link' })).toBeVisible();
  } finally {
    await other.close();
    await sql`DELETE FROM users WHERE id = ${userId}`;
  }
});
