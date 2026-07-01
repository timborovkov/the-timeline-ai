import { randomUUID } from 'node:crypto';

import { expect, type Locator, test } from '@playwright/test';
import { getDbClient } from '@timeline/db';

import { signIn } from './helpers.js';
import { E2E_PREFIX, e2eTeam, e2eUsers } from './test-data.js';

const SEED_PREFIX = `${E2E_PREFIX} integration health`;
const EXTERNAL_PREFIX = `${E2E_PREFIX}-integration-health`;
const MANAGE_PREFIX = `${E2E_PREFIX} integration manage`;
const MANAGE_EXTERNAL_PREFIX = `${E2E_PREFIX}-integration-manage`;
const SOURCE_LISTING_PREFIX = `${E2E_PREFIX} source listing`;
const SOURCE_LISTING_EXTERNAL_PREFIX = `${E2E_PREFIX}-source-listing`;

async function cleanupIntegrationHealthSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM connection_attention
    WHERE team_id = ${e2eTeam.id}
      AND summary LIKE ${`${SEED_PREFIX}%`}
  `;
  await sql`
    DELETE FROM integration_provider_budgets
    WHERE external_account_id LIKE ${`${EXTERNAL_PREFIX}%`}
  `;
  await sql`
    DELETE FROM integrations
    WHERE team_id = ${e2eTeam.id}
      AND display_name LIKE ${`${SEED_PREFIX}%`}
  `;
  await sql`
    DELETE FROM team_provider_resource_shares
    WHERE team_id = ${e2eTeam.id}
      AND external_label LIKE ${`${SEED_PREFIX}%`}
  `;
  await sql`
    DELETE FROM provider_connections
    WHERE owner_user_id = ${e2eUsers.owner.id}
      AND external_account_id LIKE ${`${EXTERNAL_PREFIX}%`}
  `;
}

async function seedIntegrationHealthState(): Promise<void> {
  const sql = getDbClient();
  await cleanupIntegrationHealthSeed();

  const githubConnectionId = randomUUID();
  const githubShareId = randomUUID();
  const githubIntegrationId = randomUUID();
  const linearIntegrationId = randomUUID();
  const linearAccountId = `${EXTERNAL_PREFIX}-linear-account`;
  const linearAppKey = process.env.LINEAR_CLIENT_ID ?? 'linear';

  await sql`
    INSERT INTO provider_connections (
      id,
      owner_user_id,
      provider,
      display_name,
      external_account_id,
      scopes,
      auth_secret_ciphertext,
      auth_secret_iv,
      auth_secret_tag
    )
    VALUES (
      ${githubConnectionId},
      ${e2eUsers.owner.id},
      'github',
      ${`${SEED_PREFIX} GitHub connection`},
      ${`${EXTERNAL_PREFIX}-github-account`},
      ARRAY['repo'],
      ${Buffer.from('ciphertext')},
      ${Buffer.from('iv')},
      ${Buffer.from('tag')}
    )
  `;
  await sql`
    INSERT INTO team_provider_resource_shares (
      id,
      team_id,
      provider_connection_id,
      resource_kind,
      external_id,
      external_label
    )
    VALUES (
      ${githubShareId},
      ${e2eTeam.id},
      ${githubConnectionId},
      'github.repo',
      'timeline/e2e-webhook-repo',
      ${`${SEED_PREFIX} repository`}
    )
  `;
  await sql`
    INSERT INTO integrations (
      id,
      team_id,
      connected_by_user_id,
      provider_connection_id,
      provider,
      display_name,
      external_account_id,
      enabled,
      last_synced_at
    )
    VALUES
      (
        ${githubIntegrationId},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        ${githubConnectionId},
        'github',
        ${`${SEED_PREFIX} GitHub`},
        ${`${EXTERNAL_PREFIX}-github-account`},
        true,
        NOW() - INTERVAL '1 hour'
      ),
      (
        ${linearIntegrationId},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        NULL,
        'linear',
        ${`${SEED_PREFIX} Linear`},
        ${linearAccountId},
        true,
        NOW() - INTERVAL '2 hours'
      )
  `;
  await sql`
    INSERT INTO integration_selections (
      integration_id,
      resource_share_id,
      selection_kind,
      external_id,
      external_label
    )
    VALUES (
      ${githubIntegrationId},
      ${githubShareId},
      'github.repo',
      'timeline/e2e-webhook-repo',
      ${`${SEED_PREFIX} repository`}
    )
  `;
  await sql`
    INSERT INTO connection_attention (
      team_id,
      provider_connection_id,
      integration_id,
      resource_share_id,
      category,
      summary
    )
    VALUES (
      ${e2eTeam.id},
      ${githubConnectionId},
      ${githubIntegrationId},
      ${githubShareId},
      'webhook_degraded',
      ${`${SEED_PREFIX} webhook provisioning failed; reconciliation remains active.`}
    )
  `;
  await sql`
    INSERT INTO integration_provider_budgets (
      provider,
      app_key,
      external_account_id,
      scope,
      remaining,
      "limit",
      reset_at,
      paused_until,
      reason
    )
    VALUES (
      'linear',
      ${linearAppKey},
      ${linearAccountId},
      'requests',
      0,
      1000,
      NOW() + INTERVAL '2 hours',
      NOW() + INTERVAL '2 hours',
      'retry_after'
    )
    ON CONFLICT (provider, app_key, external_account_id, scope)
    DO UPDATE SET
      remaining = EXCLUDED.remaining,
      "limit" = EXCLUDED."limit",
      reset_at = EXCLUDED.reset_at,
      paused_until = EXCLUDED.paused_until,
      reason = EXCLUDED.reason,
      updated_at = NOW()
  `;
}

async function cleanupIntegrationManageSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM integrations
    WHERE team_id = ${e2eTeam.id}
      AND display_name LIKE ${`${MANAGE_PREFIX}%`}
  `;
  await sql`
    DELETE FROM team_provider_resource_shares
    WHERE team_id = ${e2eTeam.id}
      AND external_label LIKE ${`${MANAGE_PREFIX}%`}
  `;
  await sql`
    DELETE FROM provider_connections
    WHERE owner_user_id = ${e2eUsers.owner.id}
      AND external_account_id LIKE ${`${MANAGE_EXTERNAL_PREFIX}%`}
  `;
}

async function cleanupSourceListingSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM team_provider_resource_shares
    WHERE team_id = ${e2eTeam.id}
      AND external_label LIKE ${`${SOURCE_LISTING_PREFIX}%`}
  `;
  await sql`
    DELETE FROM provider_connections
    WHERE owner_user_id = ${e2eUsers.owner.id}
      AND external_account_id LIKE ${`${SOURCE_LISTING_EXTERNAL_PREFIX}%`}
  `;
}

async function seedSourceListingState(): Promise<{ connectionId: string }> {
  const sql = getDbClient();
  await cleanupSourceListingSeed();

  const connectionId = randomUUID();
  await sql`
    INSERT INTO provider_connections (
      id,
      owner_user_id,
      provider,
      display_name,
      external_account_id,
      scopes,
      auth_secret_ciphertext,
      auth_secret_iv,
      auth_secret_tag
    )
    VALUES (
      ${connectionId},
      ${e2eUsers.owner.id},
      'github',
      ${`${SOURCE_LISTING_PREFIX} GitHub account`},
      ${`${SOURCE_LISTING_EXTERNAL_PREFIX}-github-account`},
      ARRAY['repo'],
      ${Buffer.from('ciphertext')},
      ${Buffer.from('iv')},
      ${Buffer.from('tag')}
    )
  `;

  return { connectionId };
}

async function seedIntegrationManageState(): Promise<{
  firstConnectionId: string;
  secondConnectionId: string;
}> {
  const sql = getDbClient();
  await cleanupIntegrationManageSeed();

  const firstConnectionId = randomUUID();
  const secondConnectionId = randomUUID();
  const sharedExternalId = 'timeline/e2e-replace-repo';

  await sql`
    INSERT INTO provider_connections (
      id,
      owner_user_id,
      provider,
      display_name,
      external_account_id,
      scopes,
      auth_secret_ciphertext,
      auth_secret_iv,
      auth_secret_tag
    )
    VALUES
      (
        ${firstConnectionId},
        ${e2eUsers.owner.id},
        'github',
        ${`${MANAGE_PREFIX} first GitHub connection`},
        ${`${MANAGE_EXTERNAL_PREFIX}-github-first`},
        ARRAY['repo'],
        ${Buffer.from('ciphertext')},
        ${Buffer.from('iv')},
        ${Buffer.from('tag')}
      ),
      (
        ${secondConnectionId},
        ${e2eUsers.owner.id},
        'github',
        ${`${MANAGE_PREFIX} second GitHub connection`},
        ${`${MANAGE_EXTERNAL_PREFIX}-github-second`},
        ARRAY['repo'],
        ${Buffer.from('ciphertext')},
        ${Buffer.from('iv')},
        ${Buffer.from('tag')}
      )
  `;
  await sql`
    INSERT INTO team_provider_resource_shares (
      team_id,
      provider_connection_id,
      resource_kind,
      external_id,
      external_label
    )
    VALUES
      (
        ${e2eTeam.id},
        ${firstConnectionId},
        'github.repo',
        ${sharedExternalId},
        ${`${MANAGE_PREFIX} replacement repo`}
      ),
      (
        ${e2eTeam.id},
        ${secondConnectionId},
        'github.repo',
        ${sharedExternalId},
        ${`${MANAGE_PREFIX} replacement repo`}
      )
  `;

  return { firstConnectionId, secondConnectionId };
}

async function activeIntegrationConnectionIdForManageRepo(): Promise<string | null> {
  const sql = getDbClient();
  const rows = await sql<{ provider_connection_id: string | null }[]>`
    SELECT i.provider_connection_id
    FROM integration_selections s
    INNER JOIN integrations i ON i.id = s.integration_id
    WHERE i.team_id = ${e2eTeam.id}
      AND s.selection_kind = 'github.repo'
      AND s.external_id = 'timeline/e2e-replace-repo'
    ORDER BY i.updated_at DESC
    LIMIT 1
  `;
  return rows[0]?.provider_connection_id ?? null;
}

async function clickSourceCheckbox(sourceCard: Locator, label: string): Promise<void> {
  await sourceCard.locator('label').filter({ hasText: label }).getByRole('checkbox').check();
}

test.describe.serial('integrations health states', () => {
  test.beforeAll(async () => {
    await seedIntegrationHealthState();
  });

  test.afterAll(async () => {
    await cleanupIntegrationHealthSeed();
  });

  test('shows webhook degradation as non-blocking and provider cooldown as paused', async ({
    page,
  }) => {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/integrations');

    await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible();
    await expect(page.getByText('1 webhook subscription degraded')).toBeVisible();
    await expect(page.getByText('integration items need attention')).toHaveCount(0);

    const githubRow = page
      .locator('li')
      .filter({ hasText: `${SEED_PREFIX} GitHub` })
      .first();
    await expect(githubRow.getByText('Webhook delivery degraded:')).toBeVisible();
    await expect(githubRow.getByText('reconciliation remains active')).toBeVisible();
    await expect(githubRow.getByRole('button', { name: 'Sync now' })).toBeEnabled();

    const linearRow = page
      .locator('li')
      .filter({ hasText: `${SEED_PREFIX} Linear` })
      .first();
    await expect(linearRow.getByText('Provider quota cooldown (requests).')).toBeVisible();
    await expect(linearRow.getByRole('button', { name: 'Paused' })).toBeDisabled();
  });

  test('keeps integration management usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/integrations');

    await expect(page.getByText('1 webhook subscription degraded')).toBeVisible();
    await expect(page.getByLabel('Open floating agent chat')).toBeHidden();

    const sourceCard = page
      .locator('section.rounded-md')
      .filter({ hasText: `${SEED_PREFIX} GitHub connection` })
      .first();
    const saveButton = sourceCard.getByRole('button', { name: 'Save team sync' });
    await expect(saveButton).toBeVisible();

    const sourceBox = await sourceCard.boundingBox();
    const buttonBox = await saveButton.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox?.width ?? 0).toBeGreaterThan(280);
    expect((buttonBox?.x ?? 0) + (buttonBox?.width ?? 0)).toBeLessThanOrEqual(
      (sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) + 1,
    );

    const githubRow = page
      .locator('li')
      .filter({ hasText: `${SEED_PREFIX} GitHub` })
      .first();
    const attentionPanel = githubRow
      .locator('div.rounded-sm')
      .filter({ hasText: 'Webhook delivery degraded:' })
      .first();
    await expect(attentionPanel).toBeVisible();
    const attentionBox = await attentionPanel.boundingBox();
    expect(attentionBox).not.toBeNull();
    expect(attentionBox?.width ?? 0).toBeGreaterThan(300);

    const syncButton = githubRow.getByRole('button', { name: 'Sync now' });
    const disconnectButton = githubRow.getByRole('button', { name: 'Disconnect' });
    const syncBox = await syncButton.boundingBox();
    const disconnectBox = await disconnectButton.boundingBox();
    expect(syncBox).not.toBeNull();
    expect(disconnectBox).not.toBeNull();
    expect(syncBox?.width ?? 0).toBeGreaterThan(130);
    expect(disconnectBox?.width ?? 0).toBeGreaterThan(130);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 0;
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });
});

test.describe.serial('integrations source management', () => {
  test.afterAll(async () => {
    await cleanupIntegrationManageSeed();
  });

  test('activates shared provider sources and replaces the active connection', async ({ page }) => {
    const { firstConnectionId, secondConnectionId } = await seedIntegrationManageState();
    const sourceLabel = `${MANAGE_PREFIX} replacement repo`;

    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/integrations');

    const firstCard = page
      .locator('section.rounded-md')
      .filter({ hasText: `${MANAGE_PREFIX} first GitHub connection` })
      .first();
    await expect(firstCard.getByText('Shared, not syncing')).toBeVisible();
    await clickSourceCheckbox(firstCard, sourceLabel);
    await expect(firstCard.getByText('1 source selected for team sync')).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/team/integrations/activate') &&
          response.request().method() === 'POST',
      ),
      firstCard.getByRole('button', { name: 'Activate team sync' }).click(),
    ]);
    await expect(firstCard.getByRole('button', { name: 'Save team sync' })).toBeVisible();
    await expect.poll(() => activeIntegrationConnectionIdForManageRepo()).toBe(firstConnectionId);

    const secondCard = page
      .locator('section.rounded-md')
      .filter({ hasText: `${MANAGE_PREFIX} second GitHub connection` })
      .first();
    await expect(secondCard.getByText('Shared, not syncing')).toBeVisible();
    await clickSourceCheckbox(secondCard, sourceLabel);
    await expect(secondCard.getByRole('button', { name: 'Replace active import' })).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/team/integrations/activate') &&
          response.request().method() === 'POST',
      ),
      secondCard.getByRole('button', { name: 'Replace active import' }).click(),
    ]);

    await expect(secondCard.getByRole('button', { name: 'Save team sync' })).toBeVisible();
    await expect(firstCard.getByRole('button', { name: 'Activate team sync' })).toBeVisible();
    await expect.poll(() => activeIntegrationConnectionIdForManageRepo()).toBe(secondConnectionId);
  });
});

test.describe.serial('provider-backed source listing', () => {
  test.afterAll(async () => {
    await cleanupSourceListingSeed();
  });

  test('lists live provider resources and saves selected shares from the browser', async ({
    page,
  }) => {
    const { connectionId } = await seedSourceListingState();
    const sourceLabel = `${SOURCE_LISTING_PREFIX} repository`;
    let savedResources: unknown[] | null = null;
    let getCount = 0;

    await page.route(`**/api/connections/${connectionId}/resources`, async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { resources?: unknown[] };
        savedResources = body.resources ?? [];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
        return;
      }

      getCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connection: {
            id: connectionId,
            provider: 'github',
            displayName: `${SOURCE_LISTING_PREFIX} GitHub account`,
          },
          resources: [
            {
              kind: 'github.org',
              externalId: 'timeline-e2e',
              label: `${SOURCE_LISTING_PREFIX} organization`,
            },
            {
              kind: 'github.repo',
              externalId: 'timeline-e2e/source-listing',
              label: sourceLabel,
              searchText: 'provider backed source listing repository',
            },
          ],
          shares:
            savedResources === null
              ? []
              : [
                  {
                    id: 'e2e-saved-share',
                    providerConnectionId: connectionId,
                    resourceKind: 'github.repo',
                    externalId: 'timeline-e2e/source-listing',
                    externalLabel: sourceLabel,
                    revokedAt: null,
                  },
                ],
        }),
      });
    });

    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/me/connections');

    const accountCard = page
      .locator('section.rounded-md')
      .filter({ hasText: `${SOURCE_LISTING_PREFIX} GitHub account` })
      .first();
    await expect(accountCard.getByText('Choose individual repositories')).toBeVisible();
    await expect(accountCard.getByText(`${SOURCE_LISTING_PREFIX} organization`)).toBeVisible();
    await expect(accountCard.getByText(sourceLabel)).toBeVisible();

    await accountCard.getByRole('textbox', { name: 'Search provider sources' }).fill('repository');
    await expect(accountCard.getByText(sourceLabel)).toBeVisible();
    await expect(accountCard.getByText(`${SOURCE_LISTING_PREFIX} organization`)).toHaveCount(0);

    await clickSourceCheckbox(accountCard, sourceLabel);
    await expect(accountCard.getByText('1 source shared to this team')).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/connections/${connectionId}/resources`) &&
          response.request().method() === 'PUT',
      ),
      accountCard.getByRole('button', { name: 'Save sharing' }).click(),
    ]);

    expect(savedResources).toEqual([
      {
        kind: 'github.repo',
        externalId: 'timeline-e2e/source-listing',
        label: sourceLabel,
      },
    ]);
    await expect.poll(() => getCount).toBeGreaterThanOrEqual(2);
  });
});

test('starts native provider OAuth from the integrations catalog', async ({ page }) => {
  await page.route('https://github.com/login/oauth/authorize**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>GitHub OAuth</title><h1>GitHub OAuth</h1>',
    });
  });

  await signIn(page, e2eUsers.owner.email);
  await page.goto('/app/team/integrations');
  const appOrigin = new URL(page.url()).origin;

  const githubCard = page.locator('#github');
  await expect(githubCard.getByText('GitHub', { exact: true })).toBeVisible();
  await expect(githubCard.getByText('Not configured')).toHaveCount(0);

  await Promise.all([
    page.waitForURL(/https:\/\/github\.com\/login\/oauth\/authorize/),
    githubCard.getByRole('button', { name: 'Connect' }).click(),
  ]);

  const url = new URL(page.url());
  expect(url.origin).toBe('https://github.com');
  expect(url.pathname).toBe('/login/oauth/authorize');
  expect(url.searchParams.get('client_id')).toBe('e2e-github-client-id');
  expect(url.searchParams.get('redirect_uri')).toBe(
    `${appOrigin}/api/integrations/github/callback`,
  );
  expect(url.searchParams.get('scope')).toContain('repo');
  expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('renders native provider OAuth callback denial in the browser', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/api/integrations/github/callback?error=access_denied');

  await expect(page).toHaveURL(/\/app\/team\/integrations\?error=access_denied$/);
  await expect(page.getByRole('heading', { name: 'Team integrations', level: 1 })).toBeVisible();
  await expect(page.getByText('access_denied', { exact: true })).toBeVisible();
  await expect(page.getByText('GitHub', { exact: true }).first()).toBeVisible();
});
