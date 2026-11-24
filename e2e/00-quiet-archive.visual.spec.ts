import { expect, type Page, test } from '@playwright/test';
import { closeDb, getDb } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';

import { newSignedInContext } from './helpers.js';
import { E2E_PREFIX, E2E_RUN_ID, e2eTeam, e2eUsers } from './test-data.js';

/**
 * Curated Quiet Archive visual coverage.
 *
 * Keep this set small and intentional: screenshots are binary debt. Prefer
 * behavior/layout assertions elsewhere. Only commit Linux Chromium baselines
 * (CI). On macOS, skip unless E2E_VISUAL_FORCE=1 (use Playwright Docker to
 * regenerate Linux PNGs).
 */
const fixtureLabels = [
  e2eTeam.slug,
  e2eTeam.inboundEmail,
  ...Object.values(e2eUsers).map((user) => user.email),
].map((value) => [value, value.replace(E2E_PREFIX, `timeline-e2e-${E2E_RUN_ID}`)] as const);
const VISUAL_BASELINES_ENABLED =
  process.platform === 'linux' || process.env.E2E_VISUAL_FORCE === '1';

test.beforeEach(() => {
  test.skip(
    !VISUAL_BASELINES_ENABLED,
    'Visual baselines are Linux Chromium only; set E2E_VISUAL_FORCE=1 to run/update via Docker.',
  );
});

let collectionBoardId: string | undefined;
test.afterEach(async () => {
  if (!collectionBoardId) return;
  try {
    await withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id).boards.archiveBoard(collectionBoardId);
  } finally {
    collectionBoardId = undefined;
    await closeDb();
  }
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
  await page.evaluate(async (labels) => {
    const displayValues = new Map(labels);
    await document.fonts.ready;
    window.scrollTo(0, 0);
    document.querySelector('nextjs-portal')?.remove();
    function normalizeFixtureValues() {
      // The masked reset time can wrap differently as the month or host timezone changes.
      const resetTime = document.querySelector('[data-sidebar-billing] time');
      if (resetTime && resetTime.textContent !== 'Dec 1, 12:00 AM UTC') {
        resetTime.textContent = 'Dec 1, 12:00 AM UTC';
      }
      const email = document.querySelector<HTMLInputElement>('#home-team-email');
      const displayEmail = email && displayValues.get(email.value);
      if (email && displayEmail && email.value !== displayEmail) email.value = displayEmail;
      const text = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        const displayValue = displayValues.get(node.textContent ?? '');
        if (displayValue && node.textContent !== displayValue) node.textContent = displayValue;
      }
    }
    normalizeFixtureValues();
    // React can replace a streamed member row while Playwright waits for stable frames.
    new MutationObserver(normalizeFixtureValues).observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }, fixtureLabels);
}

async function capture(page: Page, name: string, fullPage = true) {
  await stabilize(page);
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    fullPage,
    // The landing illustrations use fixed example times that are part of the design.
    mask: [page.locator('[data-visual-dynamic], time:not([data-home-root] time)')],
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
  // Full-page capture also covers product screenshots that only load near the viewport.
  for (const proof of await page.locator('[data-home-proof]').all()) {
    const image = proof.locator('img');
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element: HTMLImageElement) => element.decode());
  }
  await capture(page, 'landing-light-mobile.png');
});

test('authenticated Quiet Archive surfaces', async ({ browser }) => {
  const context = await newSignedInContext(browser, 'owner', { timezoneId: 'UTC' });
  const page = await context.newPage();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app');
  // Home's setup panel is client-fetched. The visual baseline covers its loaded
  // success state, so do not capture the transient skeleton before React commits it.
  await expect(page.getByRole('button', { name: 'Hide team setup checklist' })).toBeVisible();
  await capture(page, 'home-light-desktop.png');

  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/app/team?section=members');
  // The single page heading is also present while the member list streams in.
  await expect(page.getByText(e2eUsers.member.email, { exact: true })).toBeVisible();
  await capture(page, 'team-settings-light-mobile.png');

  await context.close();
});

for (const mode of ['dark-desktop', 'light-mobile'] as const) {
  for (const surface of [
    'tasks',
    'objects',
    'board-kanban',
    'board-list',
    'timeline',
    'files-or-meetings',
  ] as const) {
    test(`unified collection surfaces — ${mode} — ${surface}`, async ({ browser }) => {
      const context = await newSignedInContext(browser, 'owner', { timezoneId: 'UTC' });
      const page = await context.newPage();
      const mobile = mode === 'light-mobile';
      const theme = mobile ? 'light' : 'dark';
      await page.addInitScript((value) => {
        window.localStorage.setItem('theme', value);
      }, theme);
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      );
      try {
        let route = `/app/${surface}`;
        let screenshot = `collections-${surface}-${mode}.png`;
        if (surface === 'board-kanban' || surface === 'board-list') {
          const board = await withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id).boards.createBoard({
            name: 'E2E Visual Board',
            templateKind: 'task_board',
            lanes: [],
          });
          collectionBoardId = board.id;
          await page.goto('/app/boards');
          const boardHref = await page
            .locator('a[href^="/app/boards/"]')
            .first()
            .getAttribute('href');
          expect(boardHref).toBeTruthy();
          expect(boardHref).toBe(`/app/boards/${board.id}`);
          route = `${boardHref}?view=${surface === 'board-kanban' ? 'kanban' : 'list'}`;
        } else if (surface === 'files-or-meetings') {
          route = mobile ? '/app/meetings' : '/app/documents/captured';
          screenshot = mobile
            ? 'collections-meetings-light-mobile.png'
            : 'collections-captured-files-dark-desktop.png';
        }
        await page.goto(route);
        await capture(page, screenshot, false);
      } finally {
        await context.close();
      }
    });
  }
}
