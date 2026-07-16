import { expect, type Page, test } from '@playwright/test';

import { newSignedInPage } from './helpers.js';

async function stabilize(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.locator('h1').first().waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(0, 0);
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelector('nextjs-portal')?.remove();
  });
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    window.localStorage.setItem('tl-theme', value);
  }, theme);
  await page.reload();
  await stabilize(page);
}

async function capture(page: Page, name: string, fullPage = true) {
  await stabilize(page);
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    fullPage,
    mask: [page.locator('[data-visual-dynamic], time')],
    maxDiffPixels: 100,
  });
}

async function openTimelineInspector(page: Page) {
  await page.goto('/app/timeline');
  await page.locator('[data-moment-id]').first().getByRole('button').first().click();
  await expect(page.getByText('Technical details')).toBeVisible();
}

test('public Quiet Archive surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await stabilize(page);
  await expect(page).toHaveScreenshot('landing-light-desktop.png', {
    animations: 'disabled',
    fullPage: true,
  });

  await page.goto('/sign-in');
  await stabilize(page);
  await expect(page).toHaveScreenshot('sign-in-light-desktop.png', {
    animations: 'disabled',
    fullPage: true,
  });

  await setTheme(page, 'dark');
  await page.goto('/');
  await capture(page, 'landing-dark-desktop.png');
  await page.goto('/sign-in');
  await capture(page, 'sign-in-dark-desktop.png');

  await page.setViewportSize({ width: 320, height: 780 });
  await setTheme(page, 'light');
  await page.goto('/');
  await capture(page, 'landing-light-mobile.png');
});

test('authenticated Quiet Archive surfaces', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto('/app');
  await stabilize(page);
  await expect(page).toHaveScreenshot('home-light-desktop.png', {
    animations: 'disabled',
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
  });

  await openTimelineInspector(page);
  await stabilize(page);
  await expect(page).toHaveScreenshot('timeline-inspector-light-desktop.png', {
    animations: 'disabled',
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
  });

  await page.addInitScript(() => {
    window.localStorage.setItem('tl-theme', 'dark');
  });
  await page.goto('/app/chat');
  await stabilize(page);
  await expect(page).toHaveScreenshot('ask-dark-desktop.png', {
    animations: 'disabled',
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
  });

  await page.context().close();
});

test('complete desktop visual matrix', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/objects/new');
  await page.getByLabel('Type').selectOption('project');
  await page.getByLabel('Name').fill('Quiet Archive visual project');
  await page.getByRole('button', { name: 'Create object' }).click();
  await expect(page).toHaveURL(/\/app\/objects\/[0-9a-f-]{36}$/i);
  const objectHref = new URL(page.url()).pathname;

  const routes = [
    ['home', '/app'],
    ['ask', '/app/chat'],
    ['work', '/app/work'],
    ['object-detail', objectHref],
    ['documents', '/app/documents'],
    ['meetings', '/app/meetings'],
    ['connections', '/app/sources'],
    ['team-settings', '/app/team?section=members'],
    ['reconciliation', '/app/team/reconciliation'],
  ] as const;

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    for (const [name, href] of routes) {
      await page.goto(href);
      const isCoveredByFocusedSnapshot =
        (name === 'home' && theme === 'light') || (name === 'ask' && theme === 'dark');
      if (!isCoveredByFocusedSnapshot) {
        await capture(page, `${name}-${theme}-desktop.png`);
      }
    }
    await openTimelineInspector(page);
    await capture(page, `timeline-inspector-${theme}-desktop-matrix.png`);
  }

  await page.context().close();
});

test('mobile Quiet Archive surfaces', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 320, height: 780 });

  await page.goto('/app');
  await stabilize(page);
  await expect(page).toHaveScreenshot('home-light-mobile.png', {
    animations: 'disabled',
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
  });

  await page.goto('/app/team?section=members');
  await stabilize(page);
  await expect(page).toHaveScreenshot('team-settings-light-mobile.png', {
    animations: 'disabled',
    fullPage: true,
  });

  await openTimelineInspector(page);
  await capture(page, 'timeline-inspector-light-mobile.png', false);

  await page.goto('/app/chat');
  await capture(page, 'ask-light-mobile.png');

  await page.context().close();
});
