import { expect, test } from '@playwright/test';

import { signInFromCurrentPage } from './helpers.js';
import { e2eUsers } from './test-data.js';

test('returning credential sign-in uses the saved display region on the first render', async ({
  page,
}) => {
  const signInPath = '/sign-in?callbackUrl=%2Fapp%2Fteam';
  await page.goto(signInPath);
  await signInFromCurrentPage(page, e2eUsers.owner.email, /\/app\/team$/);

  const locale = page.getByLabel('Locale', { exact: true });
  const timezone = page.getByLabel('Display time zone');
  await locale.fill('de-DE');
  await timezone.selectOption('Asia/Tokyo');
  await page.getByRole('button', { name: 'Save display preferences' }).click();
  await expect(page.getByText('Display preferences saved').first()).toBeVisible();

  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto(signInPath);
  await signInFromCurrentPage(page, e2eUsers.owner.email, /\/app\/team$/);

  await expect(locale).toHaveValue('de-DE');
  await expect(timezone).toHaveValue('Asia/Tokyo');
});
