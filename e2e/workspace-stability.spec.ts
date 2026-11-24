import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { withE2eDataTransaction } from './cleanup.js';
import { newSignedInContext } from './helpers.js';
import { e2eSeedTasks, e2eTeam } from './test-data.js';

// Check the live route transition: an isolated panel render cannot catch list reflow.
for (const width of [1440, 768, 320]) {
  test(`task preview preserves the workspace at ${width}px`, async ({ browser }) => {
    const context = await newSignedInContext(browser, 'owner', {
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const { id, canonicalName } = e2eSeedTasks.mobileKanban;
    const filters = new URLSearchParams({ q: canonicalName, view: 'list' });
    await page.goto(`/app/tasks?${filters}`);
    const listUrl = page.url();
    const list = page.locator('[data-task-list]');
    const link = list.getByRole('link', { name: canonicalName, exact: true });
    const row = list.locator('[data-slot="collection-row"]').filter({
      has: page.locator(`a[href*="task=${id}"]`),
    });
    await expect(link).toBeVisible();
    // Work navigation measures its overflow and renders the cue after hydration.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const workNav = page.getByRole('navigation', { name: 'Work', exact: true });
    if (await workNav.evaluate((nav) => nav.scrollWidth > nav.clientWidth)) {
      await expect(
        page.getByText('Swipe or scroll for more work views.', { exact: true }),
      ).toBeVisible();
    }
    const before = await row.boundingBox();
    expect(before).not.toBeNull();
    await link.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Status');
    expect(await row.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(listUrl);
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
  const firstId = randomUUID();
  const secondId = randomUUID();
  const query = `workspace stability wrap ${Date.now()}`;
  await withE2eDataTransaction(async (sql) => {
    await sql`
      INSERT INTO entities (id, team_id, type, canonical_name, status)
      VALUES
        (${firstId}, ${e2eTeam.id}, 'task',
         ${`${query} inspect customer feedback and assemble the complete release checklist for the morning handoff`}, 'backlog'),
        (${secondId}, ${e2eTeam.id}, 'task',
         ${`${query} verify the integration test results with each customer workspace before publishing the migration guide`}, 'backlog')
    `;
  });

  const context = await newSignedInContext(browser, 'owner', {
    viewport: { width: 320, height: 900 },
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    let blockedScripts = 0;
    await page.route(
      (url) => url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js'),
      (route) => {
        blockedScripts += 1;
        return route.abort();
      },
    );
    await page.goto(`/app/tasks?${new URLSearchParams({ q: query, view: 'list' })}`);
    expect(blockedScripts).toBeGreaterThan(0);
    const rows = page.locator('[data-task-list]:visible [data-slot="collection-row"]');
    await expect(rows).toHaveCount(2);
    let bottom = 0;
    for (const row of await rows.all()) {
      const link = row.getByRole('link', { name: new RegExp(query) });
      await expect(link).toBeInViewport();
      const lines = await link.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      });
      expect(lines).toBeGreaterThan(1);
      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(bottom);
      bottom = box!.y + box!.height;
    }
  } finally {
    await context.close();
    await withE2eDataTransaction(async (sql) => {
      await sql`
        DELETE FROM entities WHERE team_id = ${e2eTeam.id} AND id IN (${firstId}, ${secondId})
      `;
    });
  }
});
