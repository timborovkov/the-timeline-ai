import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('pricing calculator compares plans and preserves precise input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/pricing');
  const calculator = page.locator('[data-pricing-calculator]');
  await expect(calculator.getByRole('heading', { name: 'Pay as you go breakdown' })).toBeVisible();
  await expect(calculator.getByText('€40.18', { exact: true })).toHaveCount(2);
  await expect(calculator.locator('details')).not.toHaveAttribute('open', '');
  await expect(calculator.getByRole('status')).toHaveAttribute('aria-live', 'polite');
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
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('pricing calculator fits desktop 1440 and mobile 390', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/pricing');
    const calculator = page.locator('[data-pricing-calculator]');
    await expect(
      calculator.getByRole('heading', { name: 'Pay as you go breakdown' }),
    ).toBeVisible();
    await expect(calculator.getByText('€40.18', { exact: true })).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('renders the example estimate from the server', async ({ page }) => {
    await page.goto('/pricing');
    const calculator = page.locator('[data-pricing-calculator]');
    await expect(
      calculator.getByRole('heading', { name: 'Pay as you go breakdown' }),
    ).toBeVisible();
    await expect(calculator.getByText('€40.18', { exact: true })).toHaveCount(2);
    await expect(calculator.locator('details')).not.toHaveAttribute('open', '');
    await expect(calculator.getByLabel('Assumed AI usage', { exact: true })).toHaveValue('20');
    await expect(calculator.getByLabel('Active members', { exact: true })).toHaveValue('5');
  });
});
