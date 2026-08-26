import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Response,
} from '@playwright/test';

import { E2E_PASSWORD, E2E_RUN_ID, e2eTeam, e2eUsers } from './test-data.js';

const ACTIVE_TEAM_COOKIE = 'tl_active_team';

async function pinPrimaryTeam(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: ACTIVE_TEAM_COOKIE,
      value: e2eTeam.id,
      url: new URL('/', page.url()).toString(),
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

export async function signIn(page: Page, email: string, timeoutMs = 30_000): Promise<void> {
  await page.goto('/sign-in');
  await signInFromCurrentPage(page, email, /\/app(\/timeline)?/, timeoutMs);
}

export async function signInFromCurrentPage(
  page: Page,
  email: string,
  expectedUrl: RegExp,
  timeoutMs = 30_000,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    try {
      await expect(page).toHaveURL(expectedUrl, { timeout: timeoutMs });
      await pinPrimaryTeam(page);
      return;
    } catch (error) {
      const canRetry =
        attempt === 0 &&
        (await page.getByText('Invalid email or password.', { exact: true }).isVisible());
      if (!canRetry) throw error;
      await page.reload();
    }
  }
}

type E2eUserKey = keyof typeof e2eUsers;

function authStatePath(user: E2eUserKey): string {
  return path.join('test-results', '.auth', `${E2E_RUN_ID}-${user}.json`);
}

export async function signInAndSaveState(
  page: Page,
  user: E2eUserKey,
  timeoutMs = 30_000,
): Promise<string> {
  const file = authStatePath(user);
  await mkdir(path.dirname(file), { recursive: true });
  await signIn(page, e2eUsers[user].email, timeoutMs);
  await page.context().storageState({ path: file });
  return file;
}

type SignedInContextOptions = BrowserContextOptions & { signInTimeoutMs?: number };

export async function newSignedInContext(
  browser: Browser,
  user: E2eUserKey,
  options: SignedInContextOptions = {},
): Promise<BrowserContext> {
  const { signInTimeoutMs = 30_000, ...contextOptions } = options;
  const bootstrap = await browser.newContext();
  const page = await bootstrap.newPage();
  const file = await signInAndSaveState(page, user, signInTimeoutMs);
  await bootstrap.close();
  return browser.newContext({ ...contextOptions, storageState: file });
}

export async function newSignedInPage(browser: Browser, user: E2eUserKey): Promise<Page> {
  const context = await newSignedInContext(browser, user);
  return context.newPage();
}

export async function waitForPost(
  page: Page,
  path: string,
  action: () => Promise<void>,
  ok: (response: Response) => boolean = () => true,
): Promise<void> {
  const response = page.waitForResponse(
    (res) => res.url().includes(path) && res.request().method() === 'POST' && ok(res),
  );
  await action();
  await response;
}
