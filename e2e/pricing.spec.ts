import { expect, test } from '@playwright/test';

test('public pricing page shows Free and PAYG plans', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { level: 1, name: /Start free/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pay as you go' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Public navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pricing' }).first()).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('PAYG intent survives navigation to signup without starting a purchase', async ({ page }) => {
  await page.goto('/pricing');
  await page
    .locator('[data-pricing-plan="payg"] a[data-public-analytics-cta="choose_payg"]')
    .click();
  await expect(page).toHaveURL(/\/sign-up\?plan=payg/);
  await expect(page.locator('input[name="callbackUrl"]').first()).toHaveValue(
    '/app/team?section=billing&plan=payg#change-plan',
  );
});

test('mobile pricing explains limits and links billing help', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pricing');
  await expect(
    page.getByRole('link', { name: 'How billing, limits and cancellation work' }),
  ).toBeVisible();
  await page.getByText('Infrastructure limits', { exact: true }).click();
  await expect(page.getByText('Inbound emails / month', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(
    page.locator('[data-pricing-plan="payg"] a[data-public-analytics-cta="choose_payg"]'),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/workspace/audit-evidence/pricing-mobile.png', fullPage: true });
  await page.screenshot({ path: '/workspace/audit-evidence/pricing-mobile-viewport.png' });
});

test('public and authentication responses protect framing and publish security contact', async ({
  request,
}) => {
  for (const path of ['/pricing', '/sign-up', '/sign-in']) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  for (const path of ['/forgot-password', '/reset-password']) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
  }
  const contact = await request.get('/.well-known/security.txt');
  expect(contact.ok()).toBe(true);
  expect(contact.headers()['content-type']).toContain('text/plain');
  expect(await contact.text()).toContain('Contact: https://thetimeline.cc/help/support');
  // The isolated browser fixture intentionally has no operator CRON_SECRET.
  const readiness = await request.get('/api/health/ready');
  expect(readiness.status()).toBe(503);
  expect(await readiness.json()).toEqual({ ok: false });
});

test('pricing text and primary-action tokens meet normal-text contrast in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/pricing');
  await expect(
    page.locator('[data-pricing-plan="payg"] a[data-public-analytics-cta="choose_payg"]'),
  ).toBeVisible();
  for (const dark of [false, true]) {
    const ratios = await page.evaluate((dark) => {
      document.documentElement.classList.toggle('dark', dark);
      const styles = getComputedStyle(document.documentElement);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      const luminance = (token: string) => {
        context.fillStyle = styles.getPropertyValue(token);
        context.fillRect(0, 0, 1, 1);
        const values = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
      };
      const ratio = (first: string, second: string) => {
        const a = luminance(first),
          b = luminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      return [
        ratio('--signal', '--signal-fg'),
        ratio('--fg-dim', '--bg'),
        ratio('--fg-dim', '--surface-2'),
      ];
    }, dark);
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `/workspace/audit-evidence/pricing-desktop-${dark ? 'dark' : 'light'}.png`,
    });
  }
});
