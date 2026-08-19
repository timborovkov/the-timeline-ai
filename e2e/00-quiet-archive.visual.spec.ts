import { expect, type Page, test } from '@playwright/test';

import { newSignedInPage } from './helpers.js';
import { E2E_PREFIX, E2E_RUN_ID } from './test-data.js';

/**
 * Curated Quiet Archive visual coverage.
 *
 * Keep this set small and intentional: screenshots are binary debt. Prefer
 * behavior/layout assertions elsewhere. Only commit Linux Chromium baselines
 * (CI). On macOS, skip unless E2E_VISUAL_FORCE=1 (use Playwright Docker to
 * regenerate Linux PNGs).
 */
const E2E_NAMESPACE = E2E_PREFIX.slice('timeline-e2e-'.length);
const VISUAL_BASELINES_ENABLED =
  process.platform === 'linux' || process.env.E2E_VISUAL_FORCE === '1';

test.beforeEach(() => {
  test.skip(
    !VISUAL_BASELINES_ENABLED,
    'Visual baselines are Linux Chromium only; set E2E_VISUAL_FORCE=1 to run/update via Docker.',
  );
});

async function stabilize(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.locator('h1').first().waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(0, 0);
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
  });
  await page.evaluate(
    async ({ namespace, runId }) => {
      await document.fonts.ready;
      window.scrollTo(0, 0);
      document.querySelector('nextjs-portal')?.remove();
      const text = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        if (node.textContent?.includes(namespace)) {
          node.textContent = node.textContent.replaceAll(namespace, runId);
        }
      }
    },
    { namespace: E2E_NAMESPACE, runId: E2E_RUN_ID },
  );
}

async function capture(page: Page, name: string, fullPage = true) {
  await stabilize(page);
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    fullPage,
    mask: [page.locator('[data-visual-dynamic], time')],
    maxDiffPixels: 120,
  });
}

test('public Quiet Archive surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/sign-in');
  await capture(page, 'sign-in-light-desktop.png');

  await page.goto('/help');
  await capture(page, 'help-light-desktop.png');

  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/');
  await capture(page, 'landing-light-mobile.png');
});

test('authenticated Quiet Archive surfaces', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app');
  // Home's setup panel is client-fetched. The visual baseline covers its loaded
  // success state, so do not capture the transient skeleton before React commits it.
  await expect(page.getByRole('button', { name: 'Hide team setup checklist' })).toBeVisible();
  await capture(page, 'home-light-desktop.png');

  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/app/team?section=members');
  await capture(page, 'team-settings-light-mobile.png');

  await page.context().close();
});

test('unified collection surfaces', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark');
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto('/app/tasks');
  await capture(page, 'collections-tasks-dark-desktop.png', false);
  await page.goto('/app/objects');
  await capture(page, 'collections-objects-dark-desktop.png', false);
  await page.goto('/app/boards');
  const boardHref = await page.locator('a[href^="/app/boards/"]').first().getAttribute('href');
  expect(boardHref).toBeTruthy();
  await page.goto(`${boardHref ?? '/app/boards'}?view=kanban`);
  await capture(page, 'collections-board-kanban-dark-desktop.png', false);
  await page.goto(`${boardHref ?? '/app/boards'}?view=list`);
  await capture(page, 'collections-board-list-dark-desktop.png', false);
  await page.goto('/app/timeline');
  await capture(page, 'collections-timeline-dark-desktop.png', false);
  await page.goto('/app/documents/captured');
  await capture(page, 'collections-captured-files-dark-desktop.png', false);

  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/tasks');
  await capture(page, 'collections-tasks-light-mobile.png', false);
  await page.goto('/app/objects');
  await capture(page, 'collections-objects-light-mobile.png', false);
  await page.goto(`${boardHref ?? '/app/boards'}?view=kanban`);
  await capture(page, 'collections-board-kanban-light-mobile.png', false);
  await page.goto(`${boardHref ?? '/app/boards'}?view=list`);
  await capture(page, 'collections-board-list-light-mobile.png', false);
  await page.goto('/app/timeline');
  await capture(page, 'collections-timeline-light-mobile.png', false);
  await page.goto('/app/meetings');
  await capture(page, 'collections-meetings-light-mobile.png', false);

  await page.context().close();
});
