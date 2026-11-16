import { expect, test, type Page } from '@playwright/test';

import { newSignedInContext } from './helpers.js';

// Cold loads must keep their geometry when authentication and fonts arrive.
// These tests hold those responses at the browser boundary, not the UI components.
async function geometry(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}

function expectStable(before: Awaited<ReturnType<typeof geometry>>, after: typeof before) {
  expect(after).toHaveLength(before.length);
  for (let i = 0; i < before.length; i++) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after[i]![key] - before[i]![key]), `element ${i}: ${key}`).toBeLessThan(1);
    }
  }
}

for (const width of [1440, 390]) {
  for (const path of ['/', '/pricing', '/integrations']) {
    for (const signedIn of [false, true]) {
      test(`session keeps ${path} stable at ${width}px (${signedIn ? 'member' : 'visitor'})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route('**/api/auth/session', async (route) => {
          await held;
          await route.fulfill({ json: signedIn ? { user: { name: 'Layout test' } } : {} });
        });
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-public-session="unknown"]').first()).toBeAttached();
        await page.evaluate(() => document.fonts.ready);
        await expect(
          page.getByRole('button', { name: 'Cookie settings', exact: true }).first(),
        ).toBeAttached();
        const selector =
          '[data-public-header] > *, main h1, main h2, main figure, [data-public-session]';
        const before = await geometry(page, selector);
        const header = page.locator('[data-public-header]');
        await expect(header.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(0);
        await expect(header.getByRole('link', { name: 'Start free', exact: true })).toHaveCount(0);
        release();
        await expect(page.locator('[data-public-session="unknown"]')).toHaveCount(0);
        expectStable(before, await geometry(page, selector));
        await expect(
          header.getByRole('link', { name: signedIn ? 'Dashboard' : 'Start free', exact: true }),
        ).toBeVisible();
        await expect(
          header.getByRole('link', { name: signedIn ? 'Start free' : 'Dashboard', exact: true }),
        ).toHaveCount(0);
        await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      });
    }
  }
}

for (const path of ['/', '/pricing', '/app', '/app/timeline']) {
  test(`late fonts do not reflow ${path}`, async ({ browser }) => {
    const context = path.startsWith('/app')
      ? await newSignedInContext(browser, 'owner')
      : await browser.newContext();
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fontRequests = 0;
    await page.route(/\.woff2(?:\?|$)/, async (route) => {
      fontRequests++;
      await held;
      await route.continue();
    });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    await expect(page.locator('h1').first()).toBeAttached();
    if (path.startsWith('/app')) {
      await expect(page.getByRole('complementary', { name: 'Application sidebar' })).toBeVisible();
    }
    await expect.poll(() => fontRequests).toBeGreaterThan(0);
    await page.waitForFunction(
      () => performance.getEntriesByName('first-contentful-paint').length > 0,
    );
    // Let font-display's short block period expire after the first paint.
    await page.waitForTimeout(300);
    const selector =
      'h1, [data-public-header], main figure, aside[aria-label="Application sidebar"], main';
    const before = await geometry(page, selector);
    release();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    expectStable(before, await geometry(page, selector));
    await context.close();
  });
}

test('hero stays complete when hydration enables motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const samples: number[] = [];
    Object.assign(window, { heroSamples: samples });
    function sample() {
      for (const element of document.querySelectorAll(
        '[data-scene="01-claim"] h1, [data-scene="01-claim"] figure > div:not([aria-hidden]), [data-scene="01-claim"] figure li',
      )) {
        const style = getComputedStyle(element);
        samples.push(Number(style.opacity));
        if (element.tagName === 'H1' && element.parentElement) {
          samples.push(Number(getComputedStyle(element.parentElement).opacity));
        }
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLElement>('[data-home-root]')
      ?.style.getPropertyValue('--home-progress'),
  );
  await page.waitForTimeout(1800);
  const samples = await page.evaluate(
    () => (window as unknown as { heroSamples: number[] }).heroSamples,
  );
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.every((opacity) => opacity === 1)).toBe(true);
});
