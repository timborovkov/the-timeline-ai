import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const LOCAL_SHOT_DIR = path.join('test-results', 'google-sign-in');
const CLOUD_SHOT_DIR = '/opt/cursor/artifacts';

test('sign-in offers Google with identity scopes only', async ({ page }) => {
  await page.goto('/sign-in');

  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  const [request] = await Promise.all([
    page.waitForRequest((pending) => pending.url().includes('accounts.google.com')),
    page.getByRole('button', { name: 'Continue with Google' }).click(),
  ]);

  const url = new URL(request.url());
  const scopes = (url.searchParams.get('scope') ?? '').split(/[\s+]/).filter(Boolean).sort();
  expect(scopes).toEqual(['email', 'openid', 'profile']);
  expect(url.searchParams.get('scope') ?? '').not.toMatch(/drive/i);
  expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/callback\/google$/);
  expect(url.searchParams.get('access_type')).not.toBe('offline');
  expect(url.searchParams.get('include_granted_scopes')).not.toBe('true');
});

test('sign-in explains linking denials without confirming an account', async ({ page }) => {
  await page.goto('/sign-in?error=OAuthAccountNotLinked');

  await expect(
    page.getByRole('alert').filter({ hasText: /never linked automatically/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

function saveSignInScreenshot(localPath: string, name: string): void {
  try {
    mkdirSync(CLOUD_SHOT_DIR, { recursive: true });
    copyFileSync(localPath, path.join(CLOUD_SHOT_DIR, name));
  } catch {
    // Cloud Agent artifact mounts are optional; CI keeps the local copy.
  }
}

test('sign-in Google button holds at desktop and 390px in light and dark', async ({ browser }) => {
  mkdirSync(LOCAL_SHOT_DIR, { recursive: true });

  const shots = [
    { name: 'sign-in-google-light-desktop.png', width: 1440, height: 1000, theme: 'light' },
    { name: 'sign-in-google-dark-desktop.png', width: 1440, height: 1000, theme: 'dark' },
    { name: 'sign-in-google-light-390.png', width: 390, height: 844, theme: 'light' },
    { name: 'sign-in-google-dark-390.png', width: 390, height: 844, theme: 'dark' },
  ] as const;

  for (const shot of shots) {
    const context = await browser.newContext({
      colorScheme: shot.theme,
      reducedMotion: 'reduce',
      viewport: { width: shot.width, height: shot.height },
    });
    await context.addInitScript((theme) => {
      window.localStorage.setItem('tl-theme', theme);
    }, shot.theme);
    const page = await context.newPage();
    try {
      await page.goto('/sign-in');
      await page.evaluate(() => document.querySelector('nextjs-portal')?.remove());
      await page.mouse.move(0, 0);
      await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCSS(
        'font-size',
        '14px',
      );
      await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCSS(
        'font-size',
        '14px',
      );
      await expect(
        page.getByRole('button', { name: 'Continue with GitHub' }).locator('svg'),
      ).toBeVisible();
      const localPath = path.join(LOCAL_SHOT_DIR, shot.name);
      await page.screenshot({ path: localPath, fullPage: true });
      saveSignInScreenshot(localPath, shot.name);
    } finally {
      await context.close();
    }
  }
});
