import { expect, test } from '@playwright/test';

import { newSignedInPage } from './helpers.js';

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

test('Home hands a private prompt to Ask exactly once without putting it in the URL', async ({
  browser,
}) => {
  const page = await newSignedInPage(browser, 'owner');
  const prompt = `What needs attention in the quiet archive ${String(Date.now())}?`;

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page
    .getByPlaceholder('Ask what changed, what is blocked, or what needs attention…')
    .fill(prompt);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/chat\?session=[^&]+$/);
  expect(page.url()).not.toContain(encodeURIComponent(prompt));
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);

  await page.reload();
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await page.context().close();
});

test('Home capture is disclosed in a focused dialog', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.goto('/app');

  await expect(page.getByPlaceholder('What happened?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Capture a moment' });
  await expect(dialog.getByPlaceholder('What happened?')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.context().close();
});

test('work and team subnavigation are URL-backed and human-readable', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');

  await page.goto('/app/work');
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/calendar/);
  await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto('/app/team?section=visibility');
  await expect(page.getByRole('link', { name: 'Visibility', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('Visibility defaults')).toBeVisible();
  await page.context().close();
});

test('normal seeded product views hide UUIDs and do not overflow at 320px', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 320, height: 780 });

  for (const path of ['/app', '/app/timeline', '/app/work', '/app/meetings', '/app/sources']) {
    await page.goto(path);
    await expect(page.locator('h1')).toHaveCount(1);
    const visibleText = await page.locator('body').innerText();
    expect(visibleText).not.toMatch(UUID_PATTERN);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }

  await page.context().close();
});

test('authenticated routes expose one page heading', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  const routes = [
    '/app',
    '/app/timeline',
    '/app/chat',
    '/app/work',
    '/app/objects',
    '/app/tasks',
    '/app/boards',
    '/app/calendar',
    '/app/approvals',
    '/app/documents',
    '/app/documents/captured',
    '/app/meetings',
    '/app/sources',
    '/app/team',
    '/app/team/jobs',
    '/app/team/reconciliation',
    '/app/team/audit',
    '/app/team/integrations',
    '/app/team/integrations/audit',
    '/app/team/mcp-servers',
    '/app/team/mcp-share',
  ];

  for (const path of routes) {
    await page.goto(path);
    await expect(page.locator('h1'), `${path} should render exactly one h1`).toHaveCount(1);
  }

  await page.context().close();
});
