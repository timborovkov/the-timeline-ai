// Exercise personal schedule editing alongside the independent Home brief.
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';
import { e2eUsers } from './test-data.js';

test('a member creates independent weekly email and daily Telegram schedules from Home', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await signIn(page, e2eUsers.member.email, 100_000);
  await page.goto('/app');
  const brief = page.getByRole('region', { name: 'Workspace brief' });
  await expect(brief.getByText('Past 3 days')).toBeVisible();
  await brief.getByRole('link', { name: 'Manage updates' }).click();
  await expect(page.getByRole('heading', { name: 'Your schedules' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily update' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit default' })).toHaveCount(0);

  await page.getByRole('link', { name: 'New update' }).click();
  await page.getByRole('link', { name: 'Weekly recap' }).click();
  await expect(page.getByRole('combobox', { name: 'Frequency' })).toHaveValue('weekly');
  await page.getByLabel('Name', { exact: true }).fill('Friday recap');
  await page.getByRole('combobox', { name: 'Day', exact: true }).selectOption('5');
  await page.getByLabel('Send time').fill('16:30');
  await expect(page.getByLabel('Look back')).toHaveValue('7');
  await expect(page.getByLabel('Deliver to')).toHaveValue('email');
  await expect(page.getByLabel('Level of detail')).toHaveValue('detailed');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Every Friday at 16:30 · Email · More context')).toBeVisible();

  await page.getByRole('link', { name: 'New update' }).click();
  await expect(page.getByLabel('Deliver to')).toHaveValue('telegram');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Every day at 09:00 · Telegram DM · Quick scan')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Friday recap' })).toBeVisible();

  await page.getByRole('link', { name: 'Edit Daily check-in' }).click();
  await page.getByLabel('Send this update').uncheck();
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Update history' }).click();
  await expect(page.getByRole('heading', { name: 'Update history' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(brief.getByRole('link', { name: 'View timeline' })).toBeVisible();
});
