import { expect, test } from '@playwright/test';

import { newSignedInContext } from './helpers.js';
import { e2eSeedTasks } from './test-data.js';

// Check the live route transition: an isolated panel render cannot catch list reflow.
for (const width of [1440, 768, 320]) {
  test(`task preview preserves the workspace at ${width}px`, async ({ browser }) => {
    const context = await newSignedInContext(browser, 'owner', {
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('/app/tasks?view=list');
    const link = page.locator(`main a[href*="task=${e2eSeedTasks.mobileKanban.id}"]`).first();
    await expect(link).toBeVisible();
    const title = await link.innerText();
    const row = page.locator('[data-slot="collection-row"]').filter({ hasText: title });
    const before = await row.boundingBox();
    await link.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Status');
    const after = await row.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/app\/tasks\?view=list$/);
    await expect(link).toBeFocused();
    await context.close();
  });
}

test('filtering to an empty task list retains the page header and toolbar position', async ({
  browser,
}) => {
  const context = await newSignedInContext(browser, 'owner', {
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto('/app/tasks?view=list');
  const heading = page.getByRole('heading', { name: 'Tasks', exact: true });
  const before = await heading.boundingBox();
  await page.goto('/app/tasks?view=list&q=nonexistent-workspace-stability-fixture');
  await expect(page.getByText('No tasks match this filter')).toBeVisible();
  const after = await heading.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.y).toBe(before?.y);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.locator('main .overflow-y-auto').last().hover();
  await page.mouse.wheel(0, 600);
  await expect(page.getByRole('link', { name: 'Clear filters' })).toBeInViewport();
  await context.close();
});

test('wrapping task rows do not overlap before hydration on a phone', async ({ browser }) => {
  const context = await newSignedInContext(browser, 'owner', {
    viewport: { width: 320, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.goto('/app/tasks?view=list');
  const rows = page.locator('[data-slot="collection-row"]');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  let bottom = 0;
  for (const row of await rows.all()) {
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(bottom);
    bottom = box!.y + box!.height;
  }
  await context.close();
});
