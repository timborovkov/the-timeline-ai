import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { closeDb } from '@timeline/db';

import { withE2eDataTransaction } from './cleanup.js';
import { E2E_PREFIX } from './test-data.js';

test.afterAll(async () => closeDb());

test('verification retains Team intent through the signed-out continuation', async ({ page }) => {
  const id = randomUUID();
  const email = `${E2E_PREFIX}-verification-${id}@example.test`;
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, 'Verification fixture')`;
    await sql`INSERT INTO "verificationToken" (identifier, token, expires) VALUES (${email}, ${digest}, now() + interval '1 hour')`;
  });
  try {
    await page.goto(`/verify-email/${token}?email=${encodeURIComponent(email)}&plan=team`);
    await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm email' }).click();
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
    await page.getByRole('link', { name: 'Continue to billing' }).click();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);
    await expect(page.locator('input[name="callbackUrl"]').first()).toHaveValue(
      '/app/team?section=billing&plan=team#change-plan',
    );
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM "verificationToken" WHERE identifier = ${email}`;
      await sql`DELETE FROM users WHERE id = ${id}`;
    });
  }
});
