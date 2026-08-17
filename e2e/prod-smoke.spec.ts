import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';
import { e2eUsers } from './test-data.js';

test('production build lets a seeded owner load app and timeline', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /timeline/i })).toBeVisible();

  await page.goto('/app/timeline');
  await expect(page.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Timeline view' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Moments, grouped related activity' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'All events, every captured source event' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Timeline presets' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText("You've reached the end of the timeline.");
});
