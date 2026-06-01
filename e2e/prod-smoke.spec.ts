import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';
import { e2eUsers } from './test-data.js';

test('production build lets a seeded owner load app and timeline', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /timeline/i })).toBeVisible();

  await page.goto('/app/timeline');
  await expect(page.getByPlaceholder('What happened?')).toBeVisible();
});
