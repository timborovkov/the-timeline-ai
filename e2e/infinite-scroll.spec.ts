import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { entities, getDb, rawEvents } from '@timeline/db';

import { newSignedInPage } from './helpers.js';
import { e2eTeam, e2eUsers } from './test-data.js';

test.describe('Infinite scroll collections', () => {
  test('timeline fetches the next page on scroll and has no inventory chip', async ({
    browser,
  }) => {
    const db = getDb();
    const marker = `Heavy scroll ${randomUUID().slice(0, 8)}`;
    const rows = Array.from({ length: 45 }, (_, index) => ({
      id: randomUUID(),
      teamId: e2eTeam.id,
      authorUserId: e2eUsers.owner.id,
      source: 'web' as const,
      contentText: `${marker} moment ${String(index + 1).padStart(2, '0')}`,
      occurredAt: new Date(Date.now() - (index + 1) * 60_000),
      visibility: 'team' as const,
      sourceMetadata: { e2e: true, infinite_scroll: true },
    }));
    await db.insert(rawEvents).values(rows);

    const page = await newSignedInPage(browser, 'owner');
    await page.goto('/app/timeline');
    await expect(page.getByRole('link', { name: 'Moments' })).toBeVisible();
    await expect(page.getByText(/\d+ loaded/i)).toHaveCount(0);
    await expect(page.getByText(/\d+ moments/i)).toHaveCount(0);

    const oldest = `${marker} moment 45`;
    const main = page.locator('#main');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await page.getByText(oldest).count()) > 0) break;
      await main.evaluate((node) => {
        node.scrollTo({ top: node.scrollHeight });
      });
      const loadMore = page.getByRole('button', { name: 'Load more' });
      if ((await loadMore.count()) > 0) await loadMore.first().click({ force: true });
      await page.waitForTimeout(400);
    }
    await expect(page.getByText(oldest)).toBeVisible();
    await expect(page.getByText('No older activity')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });

  test('filtered tasks show matching of total and a kanban card can move columns', async ({
    browser,
  }) => {
    const db = getDb();
    const marker = `ZebraScroll ${randomUUID().slice(0, 8)}`;
    const matching = Array.from({ length: 24 }, (_, index) => ({
      id: randomUUID(),
      teamId: e2eTeam.id,
      type: 'task' as const,
      canonicalName: `${marker} ${String(index + 1).padStart(2, '0')}`,
      aliases: [],
      metadata: { e2e: true },
      status: 'todo',
      ownerUserId: e2eUsers.owner.id,
    }));
    const filler = Array.from({ length: 80 }, (_, index) => ({
      id: randomUUID(),
      teamId: e2eTeam.id,
      type: 'task' as const,
      canonicalName: `Other scroll task ${index + 1}`,
      aliases: [],
      metadata: { e2e: true },
      status: index % 2 === 0 ? 'doing' : 'done',
      ownerUserId: e2eUsers.owner.id,
    }));
    await db.insert(entities).values([...matching, ...filler]);

    const page = await newSignedInPage(browser, 'owner');
    const query = encodeURIComponent(marker);
    await page.goto(`/app/tasks?q=${query}`);
    await expect(page.getByRole('status', { name: /24 of \d+/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    const sourceName = matching[0]?.canonicalName ?? '';
    await page.goto(`/app/tasks?view=kanban&q=${query}`);
    const dragHandle = page.getByRole('button', { name: `Drag ${sourceName}` });
    const doneColumn = page.getByRole('region', { name: 'Done' });
    await expect(dragHandle).toBeVisible();
    await expect(doneColumn).toBeVisible();
    await doneColumn.scrollIntoViewIfNeeded();
    await dragHandle.dragTo(doneColumn);
    await expect(doneColumn.getByText(sourceName, { exact: true })).toBeVisible();
  });
});
