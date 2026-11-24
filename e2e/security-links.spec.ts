import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { withE2eDataTransaction } from './cleanup.js';
import { signIn } from './helpers.js';
import { E2E_PASSWORD, E2E_PREFIX, e2eTeam, e2eUsers } from './test-data.js';

test('sensitive pages preserve native form origins without leaking URL tokens', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  const path = '/sign-in?callbackUrl=%2Fapp&token=synthetic-link-token';
  try {
    await page.goto(path);
    const origin = new URL(page.url()).origin;
    // Intercept the external navigation: no external service receives the probe.
    await context.route('https://referrer-probe.example.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Referrer probe' }),
    );
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = 'https://referrer-probe.example.test/';
      link.textContent = 'Referrer probe';
      document.body.append(link);
    });
    const externalRequest = page.waitForRequest('https://referrer-probe.example.test/');
    await page.getByRole('link', { name: 'Referrer probe' }).click();
    expect((await (await externalRequest).allHeaders()).referer).toBe(`${origin}/`);

    await page.goto(path);
    await page.getByLabel('Email').fill(e2eUsers.owner.email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
    const submission = page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/sign-in',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const headers = await (await submission).allHeaders();
    expect(headers.origin).toBe(origin);
    expect(headers.referer).toBe(`${origin}/`);
    await expect(page).toHaveURL(/\/app(?:\/|\?|$)/);
  } finally {
    await context.close();
  }
});

// Real browsers and PostgreSQL must agree that GET/HEAD never confirm a link.
test('email verification requires confirmation and accepts the token once', async ({
  page,
  context,
}, testInfo) => {
  const id = randomUUID();
  const email = `${E2E_PREFIX}-verification-${id}@example.test`;
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  const link = `/verify-email/${token}?email=${encodeURIComponent(email)}`;
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO users (id, email) VALUES (${id}, ${email})`;
    await sql`
      INSERT INTO "verificationToken" (identifier, token, expires)
      VALUES (${email}, ${digest}, NOW() + INTERVAL '1 day')
    `;
  });

  try {
    const head = await context.request.head(link);
    expect(head.status()).toBe(200);
    expect(head.headers()['cache-control']).toContain('no-store');
    expect(head.headers()['referrer-policy']).toBe('strict-origin');
    const second = await context.newPage();
    const [get] = await Promise.all([page.goto(link), second.goto(link)]);
    expect(get?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    const confirm = (tab: typeof page) => tab.getByRole('button', { name: 'Confirm email' });
    await expect(confirm(page)).toBeVisible();
    await expect(confirm(second)).toBeVisible();
    await withE2eDataTransaction(async (sql) => {
      const [user] = await sql`SELECT "emailVerified" FROM users WHERE id = ${id}`;
      expect(user?.emailVerified).toBeNull();
      expect(await sql`SELECT 1 FROM "verificationToken" WHERE token = ${digest}`).toHaveLength(1);
    });
    await page.screenshot({ path: testInfo.outputPath('confirm-email.png') });

    await Promise.all([confirm(page).click(), confirm(second).click()]);
    const result = /^(Email verified|Verification link invalid)$/;
    await expect(page.getByRole('heading', { name: result })).toBeVisible();
    await expect(second.getByRole('heading', { name: result })).toBeVisible();
    const headings = await Promise.all([
      page.getByRole('heading', { name: result }).textContent(),
      second.getByRole('heading', { name: result }).textContent(),
    ]);
    expect([...headings].sort()).toEqual(['Email verified', 'Verification link invalid']);
    await withE2eDataTransaction(async (sql) => {
      const [user] = await sql`SELECT "emailVerified" FROM users WHERE id = ${id}`;
      expect(user?.emailVerified).toBeTruthy();
      expect(await sql`SELECT 1 FROM "verificationToken" WHERE token = ${digest}`).toHaveLength(0);
    });
    const verified = headings[0] === 'Email verified' ? page : second;
    await verified.screenshot({ path: testInfo.outputPath('email-verified.png') });
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM "verificationToken" WHERE identifier = ${email}`;
      await sql`DELETE FROM users WHERE id = ${id}`;
    });
  }
});

test('pending invitation settings expose only a fresh-link action', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const id = randomUUID();
  const email = 'invitee@example.test';
  const token = randomBytes(24).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  await withE2eDataTransaction(async (sql) => {
    await sql`
      INSERT INTO team_invites (id, team_id, email, token, invited_by_user_id, expires_at, send_status)
      VALUES (${id}, ${e2eTeam.id}, ${email}, ${digest}, ${e2eUsers.owner.id}, NOW() + INTERVAL '1 day', 'sent')
    `;
  });
  try {
    await signIn(page, e2eUsers.owner.email, 90_000);
    await page.goto('/app/team?section=members');
    const row = page.getByRole('listitem').filter({ hasText: email });
    await expect(row.getByRole('button', { name: 'Resend invite' })).toBeVisible();
    await expect(row.getByRole('button', { name: /Copy.*invite link/ })).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(token);
    expect(html).not.toContain(digest);
    const pending = page.getByRole('list', { name: 'Pending invites' });
    await pending.screenshot({ path: testInfo.outputPath('pending-invitation.png') });
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM team_invites WHERE id = ${id}`;
    });
  }
});

test('the expanded CSP reports in Chromium and blocks scripts in enforcement mode', async ({
  page,
}) => {
  test.skip(process.env.E2E_TEST_CSP !== '1', 'Requires a production web build');
  const enforce = process.env.WEB_CSP_MODE === 'enforce';
  const response = await page.goto('/sign-up');
  const headers = response?.headers();
  const policy =
    headers?.[enforce ? 'content-security-policy' : 'content-security-policy-report-only'];
  expect(policy).toContain('https://challenges.cloudflare.com');
  expect(policy).toContain('https://eu.i.posthog.com');
  await expect(page.getByRole('heading', { name: /create.*account/i })).toBeVisible();
  const result = await page.evaluate(async () => {
    let ran = false;
    window.addEventListener(
      'timeline-csp-test',
      () => {
        ran = true;
      },
      { once: true },
    );
    const violation = new Promise<string>((resolve) => {
      window.addEventListener('securitypolicyviolation', (event) => {
        if (event.effectiveDirective === 'script-src-elem') resolve(event.disposition);
      });
    });
    const script = document.createElement('script');
    script.src = 'data:text/javascript,window.dispatchEvent(new%20Event("timeline-csp-test"))';
    const loaded = new Promise<void>((resolve) => {
      script.onload = () => resolve();
      script.onerror = () => resolve();
    });
    document.head.append(script);
    const [disposition] = await Promise.all([violation, loaded]);
    return { disposition, ran };
  });
  expect(result).toEqual({ disposition: enforce ? 'enforce' : 'report', ran: !enforce });
});
