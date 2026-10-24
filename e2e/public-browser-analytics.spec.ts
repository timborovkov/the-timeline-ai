import { devices, expect, test, type Page } from '@playwright/test';

import { newSignedInContext } from './helpers.js';

const POSTHOG_ORIGIN = 'https://eu.i.posthog.com';
const POSTHOG_PERSISTENCE_KEY = 'ph_timeline_public_analytics_v1';
const TIMELINE_CONSENT_COOKIE = 'tl_analytics_consent';
const ATTRIBUTION_COOKIE = 'tl_public_attribution';

test.skip(
  !process.env.NEXT_PUBLIC_POSTHOG_KEY,
  'Run with NEXT_PUBLIC_POSTHOG_KEY=ph-e2e to exercise the consented browser bundle.',
);

test('public PostHog stays absent until consent and is removed before private app use', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const context = await newSignedInContext(browser, 'owner', {
    signInTimeoutMs: 60_000,
    userAgent: devices['Desktop Chrome'].userAgent,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false });
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      get: () => ({
        brands: [
          { brand: 'Google Chrome', version: '149' },
          { brand: 'Chromium', version: '149' },
          { brand: 'Not_A Brand', version: '24' },
        ],
        mobile: false,
        platform: 'Windows',
      }),
    });
  });
  const page = await context.newPage();
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(POSTHOG_ORIGIN)) providerRequests.push(request.url());
  });
  await page.route(`${POSTHOG_ORIGIN}/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/app');
  await expect(page).toHaveURL(/\/app(?:\/timeline)?$/u);
  await expectNoPostHogState(page);
  expect(providerRequests).toHaveLength(0);

  await page.goto('/?utm_source=github&utm_medium=referral&utm_campaign=launch&gclid=ignored');
  await expect(page.getByRole('heading', { name: 'Optional public analytics' })).toBeVisible();
  await expectNoPostHogState(page);
  expect(providerRequests).toHaveLength(0);

  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Optional public analytics' })).toBeHidden();
  await expectNoPostHogState(page);
  expect(providerRequests).toHaveLength(0);
  await expectConsentChoice(page, 'rejected');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Optional public analytics' })).toBeHidden();
  await expectNoPostHogState(page);
  expect(providerRequests).toHaveLength(0);

  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await page.getByRole('button', { name: 'Accept analytics' }).click();
  await expectConsentChoice(page, 'accepted');
  await expect
    .poll(async () => (await browserStorage(page)).local)
    .toContain(POSTHOG_PERSISTENCE_KEY);
  await expect.poll(() => providerRequests.length).toBeGreaterThan(0);
  const acceptedStorage = await browserStorage(page);
  expect(acceptedStorage.cookies).toMatch(
    new RegExp(`${ATTRIBUTION_COOKIE}=2\\|\\d{13}\\|github\\|referral\\|launch`, 'u'),
  );
  expect(acceptedStorage.cookies).not.toContain('gclid');
  const publicIdentity = await publicDistinctId(page);
  const requestsBeforePublicNavigation = providerRequests.length;

  await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy$/u, { timeout: 30_000 });
  await expect.poll(() => providerRequests.length).toBeGreaterThan(requestsBeforePublicNavigation);
  expect(await publicDistinctId(page)).toBe(publicIdentity);

  const dashboard = page.getByRole('link', { name: 'Dashboard' }).first();
  await dashboard.evaluate((element) => {
    element.removeAttribute('data-public-analytics-cta');
  });
  const privateRequestCount = providerRequests.length;
  await dashboard.click();
  await expect(page).toHaveURL(/\/app(?:\/timeline)?$/u);
  await expectNoPostHogState(page);
  await expectConsentChoice(page, 'accepted');
  expect((await browserStorage(page)).cookies).toMatch(
    new RegExp(`${ATTRIBUTION_COOKIE}=2\\|\\d{13}\\|github\\|referral\\|launch`, 'u'),
  );
  await page.waitForTimeout(300);
  expect(providerRequests).toHaveLength(privateRequestCount);

  await page.goto('/');
  await expect.poll(() => providerRequests.length).toBeGreaterThan(privateRequestCount);
  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await page.getByRole('button', { name: 'Reject analytics' }).click();
  await expectNoPostHogState(page);
  await expectConsentChoice(page, 'rejected');
  expect((await browserStorage(page)).cookies).not.toContain(`${ATTRIBUTION_COOKIE}=`);

  await context.close();
});

async function expectNoPostHogState(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const storage = await browserStorage(page);
      return [...storage.local, ...storage.session].filter(
        (key) =>
          key.startsWith('ph_') ||
          key.startsWith('tl_posthog_') ||
          key === 'am_vid' ||
          key === 'am_sid' ||
          key === 'am_st',
      );
    })
    .toEqual([]);
}

async function expectConsentChoice(page: Page, choice: 'accepted' | 'rejected'): Promise<void> {
  await expect
    .poll(async () => (await browserStorage(page)).cookies)
    .toMatch(new RegExp(`${TIMELINE_CONSENT_COOKIE}=1\\|${choice}\\|\\d{13}`, 'u'));
}

async function browserStorage(page: Page): Promise<{
  cookies: string;
  local: string[];
  session: string[];
}> {
  return page.evaluate(() => ({
    cookies: document.cookie,
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));
}

async function publicDistinctId(page: Page): Promise<string> {
  return page.evaluate((persistenceKey) => {
    const value = window.localStorage.getItem(persistenceKey);
    const parsed: unknown = value ? JSON.parse(value) : undefined;
    if (!parsed || typeof parsed !== 'object') throw new Error('Missing public PostHog identity');
    const properties = parsed as Record<string, unknown>;
    const distinctId = properties.distinct_id ?? properties.$device_id;
    if (typeof distinctId !== 'string') throw new Error('Missing public PostHog distinct ID');
    return distinctId;
  }, POSTHOG_PERSISTENCE_KEY);
}
