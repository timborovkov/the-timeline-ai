import { expect, test } from '@playwright/test';

test('pricing calculator compares plans and preserves precise input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/pricing');
  const calculator = page.locator('[data-pricing-calculator]');
  await expect(calculator.getByRole('heading', { name: 'Pay as you go breakdown' })).toBeVisible();
  await expect(calculator.getByText('€37.18', { exact: true })).toHaveCount(2);
  await expect(calculator.locator('details')).not.toHaveAttribute('open', '');
  await calculator.getByRole('radio', { name: 'Team', exact: true }).check();
  await calculator.getByLabel('Assumed AI usage', { exact: true }).fill('650.25');
  await expect(calculator.getByLabel('Assumed AI usage slider')).toHaveValue('500');
  await expect(calculator.getByLabel('Assumed AI usage', { exact: true })).toHaveValue('650.25');
  await expect(calculator.getByRole('heading', { name: 'Team breakdown' })).toBeVisible();
  await calculator.getByLabel('Meeting hours slider').focus();
  await page.keyboard.press('ArrowRight');
  await expect(calculator.getByLabel('Meeting hours', { exact: true })).toHaveValue('11');
  await calculator.getByLabel('Active members', { exact: true }).fill('');
  await expect(calculator.getByRole('status')).toContainText('Complete all usage fields');
  await calculator.getByRole('button', { name: 'Reset example' }).click();
  await expect(calculator.getByRole('heading', { name: 'Team breakdown' })).toBeVisible();
  await calculator.locator('summary').click();
  await calculator.getByLabel('Accepted sources', { exact: true }).fill('1000001');
  await calculator.locator('summary').click();
  await expect(calculator.locator('summary')).toContainText('1,000,001 accepted sources');
  await expect(calculator.getByRole('link', { name: 'Contact sales' })).toBeVisible();
  await expect(calculator.getByText('Lowest estimated cost')).toHaveCount(0);
  await expect(page.getByText('How this estimate works', { exact: true })).toBeVisible();
  await page.getByText('How this estimate works', { exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Infrastructure limits', exact: true }),
  ).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((body) => body.clientWidth),
  );
  expect(errors).toEqual([]);
});
