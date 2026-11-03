import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';
import { e2eTeam, e2eUsers, e2eSeedEvents } from './test-data.js';

test('ordinary owners cannot discover or open the platform panel', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);
  await expect(page.getByRole('link', { name: 'Platform admin', exact: true })).toHaveCount(0);
  const response = await page.goto('/app/admin/users');
  expect(response?.status()).toBe(404);
});
for (const mobile of [false, true]) {
  test(`platform admin can browse and impersonate a member on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, e2eUsers.nonMember.email);
    await page.goto('/app/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Search by name, email, slug, or ID' })
      .fill(e2eUsers.member.email);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: e2eUsers.member.name, exact: true }).click();
    await page.getByText('Log in as this member', { exact: true }).click();
    await page.getByLabel('Purpose', { exact: true }).fill('Investigate synthetic fixture');
    await page.getByLabel('Support ticket or incident reference').fill('E2E-123');
    await page
      .getByLabel('Customer authorization and approving person, or emergency incident context')
      .fill('Synthetic fixture approved by test operator');
    await page.getByRole('button', { name: 'Start 30-minute session' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Viewing as' })).toContainText(
      e2eUsers.member.email,
    );
    await expect(page.getByRole('status').filter({ hasText: 'Viewing as' })).toContainText(
      e2eTeam.name,
    );
    expect((await page.request.get('/api/team/mcp-keys')).status()).toBe(403);
    expect((await page.request.post('/api/team/ingest-webhooks', { data: {} })).status()).toBe(403);
    await page.goto('/app/timeline');
    await expect(page.getByText(e2eSeedEvents.specificForMember).first()).toBeVisible();
    await expect(page.getByText(e2eSeedEvents.privateForOwner)).toHaveCount(0);
    await expect(page.getByText(e2eSeedEvents.otherTeam)).toHaveCount(0);
    await page.getByRole('button', { name: 'Exit impersonation', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/admin/);
    await expect(page.getByText('Viewing as', { exact: false })).toHaveCount(0);
    await page.getByRole('link', { name: 'Audit', exact: true }).click();
    await expect(page.getByText('impersonation.end', { exact: true }).first()).toBeVisible();
    for (
      let auditPage = 2;
      auditPage <= 10 &&
      (await page.getByText('impersonation.start', { exact: true }).count()) === 0;
      auditPage++
    ) {
      await page.getByRole('link', { name: 'Next', exact: true }).click();
      await expect(page.getByText(`Page ${auditPage}`, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('impersonation.start', { exact: true }).first()).toBeVisible();
  });
}

test('platform suspension blocks an existing session and permits read-only inspection', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const memberContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:3000' });
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, e2eUsers.member.email);
  await signIn(page, e2eUsers.nonMember.email);
  await page.goto(`/app/admin/users/${e2eUsers.member.id}`);
  await page.getByText('Suspend user', { exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic incident test');
  await page.getByLabel('I confirm this change').check();
  await page.getByRole('button', { name: 'Suspend access', exact: true }).click();
  await expect(page.getByText('Restore access', { exact: true }).first()).toBeVisible();
  expect((await memberPage.request.get('/api/timeline')).status()).toBe(403);
  await page.getByText('Log in as this member', { exact: true }).click();
  await page.getByLabel('Purpose', { exact: true }).fill('Inspect suspended synthetic fixture');
  await page.getByLabel('Support ticket or incident reference').fill('E2E-SUSPENSION');
  await page
    .getByLabel('Customer authorization and approving person, or emergency incident context')
    .fill('Test operator approval');
  await page.getByRole('button', { name: 'Start 30-minute session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Viewing as' })).toContainText(
    'Read-only',
  );
  expect((await page.request.post('/api/calendar/events', { data: {} })).status()).toBe(403);
  await page.getByRole('button', { name: 'Exit impersonation', exact: true }).click();
  await page.goto(`/app/admin/users/${e2eUsers.member.id}`);
  await page.locator('summary').filter({ hasText: 'Restore access' }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic incident resolved');
  await page.getByLabel('I confirm this change').check();
  await page.getByRole('button', { name: 'Restore access', exact: true }).click();
  await expect(page.getByText('Suspend user', { exact: true })).toBeVisible();
  expect((await memberPage.request.get('/api/timeline')).status()).toBe(200);
  await memberContext.close();
});

test('platform administrators can reach the panel without a team membership', async ({ page }) => {
  const { withE2eDataTransaction } = await import('./cleanup.js');
  await withE2eDataTransaction(async (sql) => {
    await sql`UPDATE team_members SET removed_at = now() WHERE user_id = ${e2eUsers.nonMember.id}`;
  });
  try {
    await signIn(page, e2eUsers.nonMember.email);
    await expect(page.getByRole('heading', { name: 'No team yet' })).toBeVisible();
    await page.getByRole('link', { name: 'Platform admin', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`UPDATE team_members SET removed_at = NULL WHERE user_id = ${e2eUsers.nonMember.id}`;
    });
  }
});

test('platform admins can change non-owner roles while owner controls stay protected', async ({
  page,
}) => {
  await signIn(page, e2eUsers.nonMember.email);
  await page.goto(`/app/admin/teams/${e2eTeam.id}`);
  const member = page
    .locator('section > div')
    .filter({ has: page.getByRole('link', { name: e2eUsers.member.name, exact: true }) });
  const owner = page
    .locator('section > div')
    .filter({ has: page.getByRole('link', { name: e2eUsers.owner.name, exact: true }) });
  await expect(owner.getByText('Manage membership', { exact: true })).toHaveCount(0);
  for (const role of ['admin', 'member']) {
    if (!(await member.getByRole('combobox', { name: 'Role', exact: true }).isVisible())) {
      await member.getByText('Manage membership', { exact: true }).click();
    }
    await member.getByRole('combobox', { name: 'Role', exact: true }).selectOption(role);
    await member.getByLabel('Reason', { exact: true }).fill('Synthetic membership management test');
    await member.getByLabel('Confirm membership change').check();
    await member.getByRole('button', { name: 'Save membership' }).click();
    await expect(
      member.getByText(`${e2eUsers.member.email} · ${role} · Active`, { exact: true }),
    ).toBeVisible();
  }
});

test('expired and forged impersonation cookies can always be exited', async ({ page }) => {
  test.setTimeout(120_000);
  const { withE2eDataTransaction } = await import('./cleanup.js');
  await signIn(page, e2eUsers.nonMember.email);
  await page.goto(`/app/admin/users/${e2eUsers.member.id}`);
  await page.getByText('Log in as this member', { exact: true }).click();
  await page.getByLabel('Purpose', { exact: true }).fill('Verify session expiry recovery');
  await page.getByLabel('Support ticket or incident reference').fill('E2E-EXPIRY');
  await page
    .getByLabel('Customer authorization and approving person, or emergency incident context')
    .fill('Synthetic test operator approval');
  await page.getByRole('button', { name: 'Start 30-minute session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Viewing as' })).toBeVisible();
  await withE2eDataTransaction(async (sql) => {
    await sql`UPDATE platform_impersonation_sessions SET expires_at = now() - interval '1 second' WHERE actor_user_id = ${e2eUsers.nonMember.id} AND ended_at IS NULL`;
  });
  expect((await page.goto('/app/timeline'))?.status()).toBe(403);
  await page.getByRole('button', { name: 'Exit impersonation', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/admin/);
  await page.context().addCookies([
    {
      name: 'tl_platform_impersonation',
      value: 'forged-session-token',
      url: new URL('/', page.url()).toString(),
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  expect((await page.goto('/app/timeline'))?.status()).toBe(403);
  await page.getByRole('button', { name: 'Exit impersonation', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/admin/);
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === 'tl_platform_impersonation'),
  ).toBe(false);
});

test('the material staff-access notice requires renewed Privacy Policy acknowledgment', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { withE2eDataTransaction } = await import('./cleanup.js');
  const { E2E_PASSWORD } = await import('./test-data.js');
  const { PRIVACY_VERSION } = await import('@timeline/shared/legal-versions');
  await withE2eDataTransaction(async (sql) => {
    await sql`UPDATE users SET legal_privacy_version = '2026-11-01' WHERE id = ${e2eUsers.owner.id}`;
  });
  try {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(e2eUsers.owner.email);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/legal\/accept/);
    await expect(
      page.getByText(`Privacy Policy ${PRIVACY_VERSION}`, { exact: false }),
    ).toBeVisible();
    expect((await page.request.get('/api/timeline')).status()).toBe(428);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
    await expect(page).toHaveURL(/\/app(?:\/|$)/);
    expect((await page.request.get('/api/timeline')).status()).toBe(200);
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`UPDATE users SET legal_privacy_version = ${PRIVACY_VERSION} WHERE id = ${e2eUsers.owner.id}`;
    });
  }
});

test('staff can exit impersonation before acknowledging a changed legal notice', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { withE2eDataTransaction } = await import('./cleanup.js');
  const { PRIVACY_VERSION } = await import('@timeline/shared/legal-versions');
  await signIn(page, e2eUsers.nonMember.email);
  await page.goto(`/app/admin/users/${e2eUsers.member.id}`);
  await page.getByText('Log in as this member', { exact: true }).click();
  await page.getByLabel('Purpose', { exact: true }).fill('Verify legal notice recovery');
  await page.getByLabel('Support ticket or incident reference').fill('E2E-LEGAL');
  await page
    .getByLabel('Customer authorization and approving person, or emergency incident context')
    .fill('Synthetic test operator approval');
  await page.getByRole('button', { name: 'Start 30-minute session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Viewing as' })).toBeVisible();
  await withE2eDataTransaction(async (sql) => {
    await sql`UPDATE users SET legal_privacy_version = '2026-11-01' WHERE id = ${e2eUsers.nonMember.id}`;
  });
  try {
    await page.goto('/app/admin');
    await expect(
      page.getByRole('button', { name: 'Exit impersonation', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Exit impersonation', exact: true }).click();
    await expect(page).toHaveURL(/\/legal\/accept/);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
    await expect(page).toHaveURL(/\/app(?:\/|$)/);
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`UPDATE users SET legal_privacy_version = ${PRIVACY_VERSION} WHERE id = ${e2eUsers.nonMember.id}`;
    });
  }
});
