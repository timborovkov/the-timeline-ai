import { expect, test } from '@playwright/test';

import { newSignedInPage } from './helpers.js';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test('Home hands a private prompt to Ask exactly once without putting it in the URL', async ({
  browser,
}) => {
  const page = await newSignedInPage(browser, 'owner');
  const prompt = `What needs attention in the quiet archive ${String(Date.now())}?`;

  await page.goto('/app');
  await expect(page.locator('h1')).toHaveCount(1);
  await page.getByLabel('Question for Ask').fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/chat\?session=[^&]+$/);
  expect(page.url()).not.toContain(encodeURIComponent(prompt));
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);

  await page.reload();
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await page.context().close();
});

test('Home capture is disclosed in a focused dialog', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.goto('/app');

  await expect(page.getByPlaceholder('What happened?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Capture a moment' });
  await expect(dialog.getByPlaceholder('What happened?')).toBeVisible();
  await expect(dialog.getByLabel('Note')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Record', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Attach', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Visible to team', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Post', exact: true })).toBeFocused();

  await dialog.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Write something, record a voice note, or attach a file.',
  );
  await expect(dialog.getByLabel('Note')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Capture', exact: true })).toBeFocused();
  await page.context().close();
});

test('Home primary controls reflow at 320px', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/app');

  await expect(page.locator('h1')).toHaveCount(1);
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Capture a moment' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Note')).toBeFocused();
  await page.keyboard.press('Escape');

  await page
    .getByRole('heading', { name: 'Team setup checklist', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('heading', { name: 'Team setup checklist', exact: true }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await page.context().close();
});

test('Documents browser reflows at 320px', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/app/documents');

  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('searchbox', { name: 'Search document chunks' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.context().close();
});

test('Task kanban retains an internal mobile scroll rail at 320px', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/app/tasks?view=kanban');

  await expect(page.locator('h1')).toHaveCount(1);
  const rail = page.getByRole('region', { name: 'Task status columns' });
  const column = rail.getByRole('region', { name: 'Backlog' });
  await expect(column).toBeVisible();
  const dimensions = await rail.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    contentWidth:
      element.clientWidth -
      Number.parseFloat(getComputedStyle(element).paddingInlineStart) -
      Number.parseFloat(getComputedStyle(element).paddingInlineEnd),
  }));
  const columnWidth = await column.evaluate((element) => element.getBoundingClientRect().width);

  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  expect(columnWidth).toBeLessThanOrEqual(dimensions.contentWidth);
  const documentDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentDimensions.scrollWidth).toBeLessThanOrEqual(documentDimensions.clientWidth);
  await page.context().close();
});

test('work and team subnavigation are URL-backed and human-readable', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');

  await page.goto('/app/work');
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/calendar/);
  await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto('/app/team?section=visibility');
  await expect(page.getByRole('link', { name: 'Visibility', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('Visibility defaults')).toBeVisible();
  await page.context().close();
});

test('AuthShell covers sign-up, invite, and email verification layouts', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 320, height: 780 });

  for (const authCase of [
    {
      path: '/sign-up',
      heading: 'Create your account',
      action: 'Create account',
    },
    {
      path: '/accept-invite/quiet-archive-layout',
      heading: 'Accept invite',
      action: 'Sign in',
    },
    {
      path: '/verify-email/quiet-archive-layout',
      heading: 'Verification link invalid',
      action: 'Open dashboard',
    },
  ]) {
    await page.goto(authCase.path);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: authCase.heading, exact: true })).toBeVisible();
    await expect(
      page.getByRole(authCase.path === '/sign-up' ? 'button' : 'link', {
        name: authCase.action,
        exact: true,
      }),
    ).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test('normal seeded product views hide UUIDs and do not overflow at 320px', async ({ browser }) => {
  test.slow();
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 320, height: 780 });

  for (const path of [
    '/app',
    '/app/timeline',
    '/app/work',
    '/app/tasks?view=list',
    '/app/objects',
    '/app/boards',
    '/app/meetings',
    '/app/sources',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1')).toHaveCount(1);
    const visibleText = await page.locator('body').innerText();
    expect(visibleText).not.toMatch(UUID_PATTERN);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }

  for (const indexPath of ['/app/objects', '/app/boards']) {
    await page.goto(indexPath);
    const detailHref = (
      await page
        .locator(`a[href^="${indexPath}/"]`)
        .evaluateAll((links) =>
          links
            .map((link) => link.getAttribute('href'))
            .filter((href): href is string => href !== null),
        )
    ).find((href) => new RegExp(`^${indexPath}/${UUID_PATTERN.source}$`, 'i').test(href));
    if (!detailHref) continue;
    await page.goto(detailHref);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }

  await page.context().close();
});

test('Ask gives the conversation the full mobile viewport', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/app/chat');

  await expect(page.getByRole('complementary')).toBeHidden();
  const composer = page.getByPlaceholder('Ask the timeline…');
  await expect(composer).toBeVisible();
  expect((await composer.boundingBox())?.width).toBeGreaterThan(240);

  await page.context().close();
});

test('authenticated routes expose one page heading', async ({ browser }) => {
  test.slow();
  const page = await newSignedInPage(browser, 'owner');
  const routes = [
    '/app',
    '/app/timeline',
    '/app/chat',
    '/app/work',
    '/app/objects',
    '/app/tasks',
    '/app/boards',
    '/app/calendar',
    '/app/approvals',
    '/app/documents',
    '/app/documents/captured',
    '/app/meetings',
    '/app/sources',
    '/app/team',
    '/app/team/jobs',
    '/app/team/reconciliation',
    '/app/team/audit',
    '/app/team/integrations',
    '/app/team/integrations/audit',
    '/app/team/mcp-servers',
    '/app/team/mcp-share',
  ];

  for (const path of routes) {
    await page.goto(path);
    await expect(page.locator('h1'), `${path} should render exactly one h1`).toHaveCount(1);
  }

  await page.context().close();
});
