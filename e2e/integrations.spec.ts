import { createHmac, randomUUID } from 'node:crypto';

import { encryptJson } from '@timeline/shared/crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { getDbClient } from '@timeline/db';

import { signIn, waitForPost } from './helpers.js';
import { E2E_PREFIX, e2eTeam, e2eUsers } from './test-data.js';

const SEED_PREFIX = `${E2E_PREFIX} integration health`;
const EXTERNAL_PREFIX = `${E2E_PREFIX}-integration-health`;
const MANAGE_PREFIX = `${E2E_PREFIX} integration manage`;
const MANAGE_EXTERNAL_PREFIX = `${E2E_PREFIX}-integration-manage`;
const SOURCE_LISTING_PREFIX = `${E2E_PREFIX} source listing`;
const SOURCE_LISTING_EXTERNAL_PREFIX = `${E2E_PREFIX}-source-listing`;
const SLACK_SETTINGS_PREFIX = `${E2E_PREFIX} Slack settings`;
const SLACK_SETTINGS_TEAM_ID = `${E2E_PREFIX}-slack-settings-team`;
const TELEGRAM_SETTINGS_PREFIX = `${E2E_PREFIX} Telegram settings`;
const TELEGRAM_SETTINGS_TG_USER_ID = 710_000_001;
const TELEGRAM_SETTINGS_CHAT_ID = -1_007_100_000_001;
const MCP_SHARE_PREFIX = `${E2E_PREFIX} MCP share`;
const OAUTH_CALLBACK_EXTERNAL_ACCOUNT_ID = 'e2e-github-user-42';

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

async function cleanupOAuthCallbackSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM provider_connections
    WHERE owner_user_id = ${e2eUsers.owner.id}
      AND provider = 'github'
      AND external_account_id = ${OAUTH_CALLBACK_EXTERNAL_ACCOUNT_ID}
  `;
}

async function cleanupMcpShareSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM raw_events
    WHERE team_id = ${e2eTeam.id}
      AND content_text LIKE ${`${MCP_SHARE_PREFIX}%`}
  `;
  await sql`
    DELETE FROM mcp_outbound_keys
    WHERE team_id = ${e2eTeam.id}
      AND name LIKE ${`${MCP_SHARE_PREFIX}%`}
  `;
}

async function seedMcpShareVisibilityEvents(input: {
  memberSpecificText: string;
  privateText: string;
  teamText: string;
}): Promise<void> {
  const sql = getDbClient();
  await cleanupMcpShareSeed();
  await sql`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_text,
      occurred_at,
      visibility,
      visibility_owner_user_id,
      visibility_user_ids,
      source_metadata
    )
    VALUES
      (
        ${randomUUID()},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        'web',
        ${input.teamText},
        '2030-01-02T10:00:00Z',
        'team',
        NULL,
        NULL,
        '{"e2e":"mcp-share","visibility":"team"}'::jsonb
      ),
      (
        ${randomUUID()},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        'web',
        ${input.privateText},
        '2030-01-02T10:01:00Z',
        'private',
        ${e2eUsers.owner.id},
        NULL,
        '{"e2e":"mcp-share","visibility":"private"}'::jsonb
      ),
      (
        ${randomUUID()},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        'web',
        ${input.memberSpecificText},
        '2030-01-02T10:02:00Z',
        'specific_users',
        NULL,
        ARRAY[${e2eUsers.member.id}]::uuid[],
        '{"e2e":"mcp-share","visibility":"specific_users"}'::jsonb
      )
  `;
}

function signProviderOAuthState(): string {
  const payload = {
    teamId: e2eTeam.id,
    userId: e2eUsers.owner.id,
    provider: 'github',
    nonce: 'e2e-oauth-callback-success',
    iat: Date.now(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = process.env.AUTH_SECRET ?? 'e2e-auth-secret-at-least-sixteen-characters';
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
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

async function cleanupSlackSettingsSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM slack_workspaces
    WHERE slack_team_id = ${SLACK_SETTINGS_TEAM_ID}
  `;
}

async function seedSlackSettingsState(): Promise<void> {
  const sql = getDbClient();
  await cleanupSlackSettingsSeed();

  const workspaceId = randomUUID();
  const slackUserId = randomUUID();
  const token = encryptJson({ accessToken: 'xoxb-e2e-slack-settings' });
  await sql`
    INSERT INTO slack_workspaces (
      id,
      slack_team_id,
      name,
      domain,
      bot_user_id,
      app_id,
      scopes,
      token_ciphertext,
      token_iv,
      token_tag,
      installed_by_user_id
    )
    VALUES (
      ${workspaceId},
      ${SLACK_SETTINGS_TEAM_ID},
      ${`${SLACK_SETTINGS_PREFIX} workspace`},
      'timeline-e2e.slack.test',
      'B_E2E_TIMELINE',
      'A_E2E_TIMELINE',
      ARRAY['channels:history','groups:history'],
      ${token.ciphertext},
      ${token.iv},
      ${token.tag},
      ${e2eUsers.owner.id}
    )
  `;
  await sql`
    INSERT INTO slack_workspace_teams (
      workspace_id,
      team_id,
      installed_by_user_id,
      enabled
    )
    VALUES (
      ${workspaceId},
      ${e2eTeam.id},
      ${e2eUsers.owner.id},
      true
    )
  `;
  await sql`
    INSERT INTO slack_conversation_bindings (
      workspace_id,
      team_id,
      slack_conversation_id,
      conversation_type,
      title,
      bound_by_user_id,
      visibility_default,
      metadata
    )
    VALUES (
      ${workspaceId},
      ${e2eTeam.id},
      'C_E2E_LAUNCH',
      'channel',
      ${`${SLACK_SETTINGS_PREFIX} #launch`},
      ${e2eUsers.owner.id},
      'team',
      '{"purpose":"e2e"}'::jsonb
    )
  `;
  await sql`
    INSERT INTO slack_users (
      id,
      workspace_id,
      slack_user_id,
      name,
      real_name,
      email,
      metadata
    )
    VALUES (
      ${slackUserId},
      ${workspaceId},
      'U_E2E_MEMBER',
      'e2e-member',
      ${`${SLACK_SETTINGS_PREFIX} Member`},
      ${e2eUsers.member.email},
      '{"source":"e2e"}'::jsonb
    )
  `;
  await sql`
    INSERT INTO slack_user_teams (
      slack_user_id,
      team_id,
      user_id,
      linked_by_user_id,
      is_active
    )
    VALUES (
      ${slackUserId},
      ${e2eTeam.id},
      ${e2eUsers.member.id},
      ${e2eUsers.member.id},
      true
    )
  `;
}

async function slackBindingRows(): Promise<{ id: string; slack_conversation_id: string }[]> {
  const sql = getDbClient();
  return sql<{ id: string; slack_conversation_id: string }[]>`
    SELECT id, slack_conversation_id
    FROM slack_conversation_bindings
    WHERE team_id = ${e2eTeam.id}
      AND enabled = true
      AND slack_conversation_id IN ('C_E2E_LAUNCH', 'C_E2E_SUPPORT')
    ORDER BY slack_conversation_id ASC
  `;
}

async function cleanupTelegramSettingsSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM telegram_link_tokens
    WHERE team_id = ${e2eTeam.id}
      AND (
        target_tg_username IN ('seed_group_admin', 'e2egroupadmin')
        OR token LIKE ${`${E2E_PREFIX}-telegram-settings-%`}
      )
  `;
  await sql`
    DELETE FROM telegram_chat_bindings
    WHERE team_id = ${e2eTeam.id}
      AND title LIKE ${`${TELEGRAM_SETTINGS_PREFIX}%`}
  `;
  await sql`
    DELETE FROM telegram_user_teams
    WHERE team_id = ${e2eTeam.id}
      AND telegram_user_id IN (
        SELECT id FROM telegram_users WHERE tg_user_id = ${TELEGRAM_SETTINGS_TG_USER_ID}
      )
  `;
  await sql`
    DELETE FROM telegram_users
    WHERE tg_user_id = ${TELEGRAM_SETTINGS_TG_USER_ID}
  `;
}

async function seedTelegramSettingsState(): Promise<void> {
  const sql = getDbClient();
  await cleanupTelegramSettingsSeed();

  const telegramUserId = randomUUID();
  await sql`
    INSERT INTO telegram_link_tokens (
      token,
      team_id,
      scope,
      issued_by_user_id,
      target_tg_username,
      expires_at
    )
    VALUES (
      ${`${E2E_PREFIX}-telegram-settings-seeded-token`},
      ${e2eTeam.id},
      'group',
      ${e2eUsers.member.id},
      'seed_group_admin',
      ${new Date(Date.now() + 15 * 60 * 1000).toISOString()}
    )
  `;
  await sql`
    INSERT INTO telegram_chat_bindings (
      tg_chat_id,
      team_id,
      bound_by_user_id,
      title
    )
    VALUES (
      ${TELEGRAM_SETTINGS_CHAT_ID},
      ${e2eTeam.id},
      ${e2eUsers.owner.id},
      ${`${TELEGRAM_SETTINGS_PREFIX} group`}
    )
  `;
  await sql`
    INSERT INTO telegram_users (
      id,
      tg_user_id,
      username,
      first_name,
      last_name,
      user_id
    )
    VALUES (
      ${telegramUserId},
      ${TELEGRAM_SETTINGS_TG_USER_ID},
      'timeline_e2e_member',
      'Telegram',
      'Member',
      ${e2eUsers.member.id}
    )
  `;
  await sql`
    INSERT INTO telegram_user_teams (
      telegram_user_id,
      team_id,
      linked_by_user_id,
      is_active
    )
    VALUES (
      ${telegramUserId},
      ${e2eTeam.id},
      ${e2eUsers.member.id},
      true
    )
  `;
}

async function telegramPendingTokenUsernames(): Promise<string[]> {
  const sql = getDbClient();
  const rows = await sql<{ target_tg_username: string | null }[]>`
    SELECT target_tg_username
    FROM telegram_link_tokens
    WHERE team_id = ${e2eTeam.id}
      AND consumed_at IS NULL
      AND target_tg_username IN ('seed_group_admin', 'e2egroupadmin')
    ORDER BY target_tg_username ASC
  `;
  return rows.map((row) => row.target_tg_username ?? '');
}

async function telegramBoundGroupTitles(): Promise<string[]> {
  const sql = getDbClient();
  const rows = await sql<{ title: string | null }[]>`
    SELECT title
    FROM telegram_chat_bindings
    WHERE team_id = ${e2eTeam.id}
      AND title LIKE ${`${TELEGRAM_SETTINGS_PREFIX}%`}
    ORDER BY title ASC
  `;
  return rows.map((row) => row.title ?? '');
}

async function clickSourceCheckbox(sourceCard: Locator, label: string): Promise<void> {
  await sourceCard.locator('label').filter({ hasText: label }).getByRole('checkbox').check();
}

test('Slack settings page renders seeded workspace status for members', async ({ page }) => {
  await seedSlackSettingsState();
  await signIn(page, e2eUsers.member.email);

  await page.goto('/app/team/slack');

  await expect(page.getByRole('heading', { name: 'Slack', level: 1 })).toBeVisible();
  await expect(page.getByText(`${SLACK_SETTINGS_PREFIX} workspace`)).toBeVisible();
  await expect(page.getByText(`workspace ${SLACK_SETTINGS_TEAM_ID} · enabled`)).toBeVisible();
  await expect(page.getByText(`${SLACK_SETTINGS_PREFIX} #launch`)).toBeVisible();
  await expect(page.getByText('channel · default visibility team')).toBeVisible();
  await expect(page.getByText(e2eUsers.member.name)).toBeVisible();
  await expect(
    page.getByText(`Slack ${SLACK_SETTINGS_PREFIX} Member · ${e2eUsers.member.email}`),
  ).toBeVisible();
  await expect(page.getByText('active DM')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect identity' })).toHaveAttribute(
    'href',
    '/api/slack/user-link/start',
  );
  await expect(page.getByRole('link', { name: 'Reconnect' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bind' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unbind' })).toHaveCount(0);
});

test('Slack settings admins can bind and unbind seeded provider conversations', async ({
  page,
}) => {
  await seedSlackSettingsState();
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app/team/slack');

  await expect(page.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
    'href',
    '/api/slack/install/start',
  );
  await expect(page.getByRole('option', { name: '#support' })).toHaveCount(1);
  await expect(page.getByRole('option', { name: '#private-plans (invite bot first)' })).toHaveCount(
    1,
  );
  await expect(page.getByText(`${SLACK_SETTINGS_PREFIX} #launch`)).toBeVisible();

  await page.locator('select[name="conversationId"]').selectOption('C_E2E_SUPPORT');
  await page.getByRole('button', { name: 'Bind', exact: true }).click();
  await expect(page.getByText('support')).toBeVisible();
  await expect(page.getByRole('option', { name: '#support' })).toHaveCount(0);
  await expect
    .poll(slackBindingRows)
    .toEqual([
      expect.objectContaining({ slack_conversation_id: 'C_E2E_LAUNCH' }),
      expect.objectContaining({ slack_conversation_id: 'C_E2E_SUPPORT' }),
    ]);

  const supportRow = page.getByRole('listitem').filter({ hasText: 'support' });
  await supportRow.getByRole('button', { name: 'Unbind' }).click();
  await expect(page.getByRole('option', { name: '#support' })).toHaveCount(1);
  await expect
    .poll(slackBindingRows)
    .toEqual([expect.objectContaining({ slack_conversation_id: 'C_E2E_LAUNCH' })]);
});

test('Telegram settings admins can generate tokens, revoke tokens, and unbind groups', async ({
  page,
}) => {
  await seedTelegramSettingsState();
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app/team/telegram');

  await expect(page.getByRole('heading', { name: 'Telegram', level: 1 })).toBeVisible();
  await expect(page.getByText('Link a personal DM', { exact: true })).toBeVisible();
  await expect(page.getByText('Bind a group chat', { exact: true })).toBeVisible();
  await expect(page.getByText('Group binding', { exact: true })).toBeVisible();
  await expect(page.getByText('issued by another teammate')).toBeVisible();
  await expect(page.getByText(`${TELEGRAM_SETTINGS_PREFIX} group`)).toBeVisible();
  await expect(page.getByText(`chat_id ${String(TELEGRAM_SETTINGS_CHAT_ID)}`)).toBeVisible();
  await expect(page.getByText(e2eUsers.member.name)).toBeVisible();
  await expect(page.getByText(`tg:timeline_e2e_member · ${e2eUsers.member.email}`)).toBeVisible();
  await expect(page.getByText('active DM')).toBeVisible();

  await page.locator('#group-tg-username').fill('e2egroupadmin');
  await page.getByRole('button', { name: 'Generate group link' }).click();
  await expect(page.getByText('Single-use token, expires in 15 minutes.')).toBeVisible();
  await expect.poll(telegramPendingTokenUsernames).toEqual(['e2egroupadmin', 'seed_group_admin']);

  const seededTokenRow = page
    .getByRole('listitem')
    .filter({ hasText: 'issued by another teammate' });
  await seededTokenRow.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('issued by another teammate')).toHaveCount(0);
  await expect.poll(telegramPendingTokenUsernames).toEqual(['e2egroupadmin']);

  const groupRow = page
    .getByRole('listitem')
    .filter({ hasText: `${TELEGRAM_SETTINGS_PREFIX} group` });
  await groupRow.getByRole('button', { name: 'Unbind' }).click();
  await expect(page.getByText('No groups bound yet.')).toBeVisible();
  await expect.poll(telegramBoundGroupTitles).toEqual([]);
});

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
    await waitForPost(page, '/api/team/integrations/activate', () =>
      firstCard.getByRole('button', { name: 'Activate team sync' }).click(),
    );
    await expect(firstCard.getByRole('button', { name: 'Save team sync' })).toBeVisible();
    await expect.poll(() => activeIntegrationConnectionIdForManageRepo()).toBe(firstConnectionId);

    const secondCard = page
      .locator('section.rounded-md')
      .filter({ hasText: `${MANAGE_PREFIX} second GitHub connection` })
      .first();
    await expect(secondCard.getByText('Shared, not syncing')).toBeVisible();
    await clickSourceCheckbox(secondCard, sourceLabel);
    await expect(secondCard.getByRole('button', { name: 'Replace active import' })).toBeVisible();
    await waitForPost(page, '/api/team/integrations/activate', () =>
      secondCard.getByRole('button', { name: 'Replace active import' }).click(),
    );

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
  await expect(page.getByText('access_denied', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('GitHub', { exact: true }).first()).toBeVisible();
});

test('Timeline MCP bearer keys expose only team-visible events', async ({ page }) => {
  const stamp = Date.now();
  const teamText = `${MCP_SHARE_PREFIX} team-visible event ${stamp}`;
  const privateText = `${MCP_SHARE_PREFIX} private owner event ${stamp}`;
  const memberSpecificText = `${MCP_SHARE_PREFIX} member-specific event ${stamp}`;
  await seedMcpShareVisibilityEvents({ teamText, privateText, memberSpecificText });

  try {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/mcp-share');
    await expect(page.getByRole('heading', { name: 'Timeline as MCP server' })).toBeVisible();
    await expect(page.getByText('Team-visible only')).toBeVisible();

    await page.getByRole('button', { name: 'New key' }).click();
    await page.getByPlaceholder('Claude Desktop · personal mac').fill(`${MCP_SHARE_PREFIX} key`);
    await waitForPost(
      page,
      '/api/team/mcp-keys',
      () => page.getByRole('button', { name: 'Create' }).click(),
      (res) => res.ok(),
    );

    const keyTitle = page.getByText('New key: copy now', { exact: false });
    const keyCard = keyTitle.locator('xpath=ancestor::div[.//code][1]');
    await expect(keyCard).toBeVisible();
    const plaintext = (await keyCard.locator('code').first().innerText()).trim();
    expect(plaintext).toMatch(/^tla_/);

    const response = await page.request.post('/api/mcp/server', {
      headers: { authorization: `Bearer ${plaintext}` },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'timeline.list_events',
          arguments: {
            source: 'web',
            from: '2030-01-02T00:00:00Z',
            to: '2030-01-03T00:00:00Z',
            limit: 10,
          },
        },
      },
    });
    expect(response.ok()).toBe(true);
    const rpc = (await response.json()) as {
      error?: unknown;
      result?: { content?: { text?: string }[] };
    };
    expect(rpc.error).toBeUndefined();
    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? '{}') as {
      count: number;
      events: { content_text: string }[];
    };
    const texts = payload.events.map((event) => event.content_text);
    expect(payload.count).toBe(1);
    expect(texts).toContain(teamText);
    expect(texts).not.toContain(privateText);
    expect(texts).not.toContain(memberSpecificText);
  } finally {
    await cleanupMcpShareSeed();
  }
});

test.describe.serial('provider OAuth callback success', () => {
  test.afterAll(async () => {
    await cleanupOAuthCallbackSeed();
  });

  test('creates a provider account and lands on source sharing', async ({ page }) => {
    await cleanupOAuthCallbackSeed();
    await page.route('**/api/connections/*/resources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resources: [],
          shares: [],
        }),
      });
    });

    await signIn(page, e2eUsers.owner.email);

    const state = signProviderOAuthState();
    await page.goto(
      `/api/integrations/github/callback?code=e2e-github-oauth-success&state=${encodeURIComponent(
        state,
      )}`,
    );

    await expect(page).toHaveURL(
      /\/app\/me\/connections\?connected=github&providerConnectionId=[0-9a-f-]+$/,
    );
    await expect(page.getByRole('heading', { name: 'Provider accounts', level: 1 })).toBeVisible();
    await expect(
      page.getByText('Connected github. Choose which sources this team may use.'),
    ).toBeVisible();
    const accountCard = page
      .locator('section.rounded-md')
      .filter({ hasText: 'GitHub - Timeline E2E' })
      .first();
    await expect(accountCard.getByText('GitHub - Timeline E2E')).toBeVisible();
    await expect(accountCard.getByText('Personal provider account')).toBeVisible();
  });
});
