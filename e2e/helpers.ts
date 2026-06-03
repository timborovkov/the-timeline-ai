import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { E2E_PASSWORD, E2E_RUN_ID, e2eUsers } from './test-data.js';

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await signInFromCurrentPage(page, email, /\/app(\/timeline)?/);
}

export async function signInFromCurrentPage(
  page: Page,
  email: string,
  expectedUrl: RegExp,
): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(expectedUrl);
}

type E2eUserKey = keyof typeof e2eUsers;

function authStatePath(user: E2eUserKey): string {
  return path.join('test-results', '.auth', `${E2E_RUN_ID}-${user}.json`);
}

export async function signInAndSaveState(page: Page, user: E2eUserKey): Promise<string> {
  const file = authStatePath(user);
  await mkdir(path.dirname(file), { recursive: true });
  await signIn(page, e2eUsers[user].email);
  await page.context().storageState({ path: file });
  return file;
}

export async function newSignedInContext(
  browser: Browser,
  user: E2eUserKey,
): Promise<BrowserContext> {
  const bootstrap = await browser.newContext();
  const page = await bootstrap.newPage();
  const file = await signInAndSaveState(page, user);
  await bootstrap.close();
  return browser.newContext({ storageState: file });
}

export async function newSignedInPage(browser: Browser, user: E2eUserKey): Promise<Page> {
  const context = await newSignedInContext(browser, user);
  return context.newPage();
}
