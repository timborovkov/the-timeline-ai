import { createHash, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { closeDb, getDbClient } from '@timeline/db';

test.afterAll(async () => closeDb());

test('verification retains PAYG intent through the signed-out continuation', async ({ page }) => {
  const sql = getDbClient();
  const id = randomUUID();
  const email = `verification-${id}@example.test`;
  const token = randomUUID();
  const digest = createHash('sha256').update(token).digest('hex');
  await sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, 'Verification fixture')`;
  await sql`INSERT INTO "verificationToken" (identifier, token, expires) VALUES (${email}, ${digest}, now() + interval '1 hour')`;
  try {
    await page.goto(`/verify-email/${token}?email=${encodeURIComponent(email)}&plan=payg`);
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
    await page.getByRole('link', { name: 'Continue to billing' }).click();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);
    await expect(page.locator('input[name="callbackUrl"]').first()).toHaveValue(
      '/app/team?section=billing&plan=payg#change-plan',
    );
  } finally {
    await sql`DELETE FROM "verificationToken" WHERE identifier = ${email}`;
    await sql`DELETE FROM users WHERE id = ${id}`;
  }
});
