import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';
import { e2eUsers } from './test-data.js';

test('public 404 responses carry one noindex directive and no canonical', async ({ request }) => {
  for (const path of ['/seo-smoke-missing-page', '/help/seo-smoke-missing-article']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    const html = await response.text();
    const directives = html.match(/<meta\s+name="(?:robots|googlebot)"[^>]*>/gu);
    expect(directives, path).toEqual([expect.stringContaining('content="noindex"')]);
    expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"/u);
    expect(response.headers()['x-robots-tag'], path).toBeUndefined();
  }
});

test('high-intent pages publish distinct social cards', async ({ page, request }) => {
  const paths = [
    '/pricing',
    '/product-tour',
    '/guides/search-slack-and-google-drive-together',
    '/guides/track-action-items-meetings-slack-email',
    '/guides/automate-daily-team-updates-in-slack',
  ];
  const imageUrls = new Set<string>();
  const imageBytes = new Set<string>();
  for (const path of paths) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), path).toBe(200);
    const image = page.locator('meta[property="og:image"]');
    await expect(image).toHaveCount(1);
    const url = await image.getAttribute('content');
    if (!url) throw new Error(`Missing social image URL for ${path}`);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', url);
    const asset = await request.get(url, { maxRedirects: 0 });
    expect(asset.status(), url).toBe(200);
    expect(asset.headers()['content-type']).toContain('image/png');
    const bytes = await asset.body();
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    imageUrls.add(url);
    imageBytes.add(bytes.toString('base64'));
  }
  expect(imageUrls.size).toBe(paths.length);
  expect(imageBytes.size).toBe(paths.length);
});

test('production build lets a seeded owner load app and timeline', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /timeline/i })).toBeVisible();

  await page.goto('/app/timeline');
  await expect(page.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Timeline view' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Moments, grouped related activity' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'All events, every captured source event' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Timeline presets' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^No older activity$/ })).toBeVisible();
});
