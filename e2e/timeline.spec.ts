import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';
import { e2eUsers } from './test-data.js';

test('seeded owner can sign in and load the app shell', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /timeline/i })).toBeVisible();

  await page.goto('/app/timeline');
  await expect(page.getByPlaceholder('What happened?')).toBeVisible();
});

test('team-visible captured text events appear for another seeded member', async ({
  browser,
  page,
}) => {
  const note = `E2E shared note ${Date.now()}`;

  await signIn(page, e2eUsers.owner.email);
  await page.goto('/app/timeline');
  const capture = page.getByRole('region', { name: 'Capture' });
  const textarea = capture.getByPlaceholder('What happened?');
  await textarea.pressSequentially(note);
  await expect(textarea).toHaveValue(note);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText(note).first()).toBeVisible();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await signIn(memberPage, e2eUsers.member.email);
    await memberPage.goto('/app/timeline');
    await expect(memberPage.getByText(note).first()).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
