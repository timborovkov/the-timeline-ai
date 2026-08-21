import { expect, test } from '@playwright/test';

test('public pricing page shows Free and PAYG plans', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { level: 1, name: /Start free/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pay as you go' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Public navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pricing' }).first()).toHaveAttribute(
    'aria-current',
    'page',
  );
});
