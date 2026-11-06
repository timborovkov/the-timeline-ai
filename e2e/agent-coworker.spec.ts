import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { closeDb, getDbClient } from '@timeline/db';
import { decryptJson } from '@timeline/shared/crypto';
import { withE2eDataTransaction } from './cleanup.js';
import { signIn } from './helpers.js';
import { e2eUsers } from './test-data.js';

const createdEmails: string[] = [];
const createdWorkspaceNames: string[] = [];
const registeredClients: string[] = [];
test.afterAll(async () => {
  try {
    await withE2eDataTransaction(async (sql) => {
      await sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
      try {
        for (const email of createdEmails) {
          await sql`DELETE FROM audit_log WHERE team_id IN (SELECT m.team_id FROM team_members m JOIN users u ON u.id=m.user_id WHERE u.email=${email} AND m.role='owner')`;
        }
        for (const name of createdWorkspaceNames) {
          await sql`DELETE FROM audit_log WHERE team_id IN (SELECT t.id FROM teams t JOIN team_members m ON m.team_id=t.id WHERE t.name=${name} AND m.user_id=${e2eUsers.owner.id} AND m.role='owner')`;
        }
      } finally {
        await sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
      }

      for (const email of createdEmails) {
        await sql`DELETE FROM teams WHERE id IN (SELECT m.team_id FROM team_members m JOIN users u ON u.id=m.user_id WHERE u.email=${email} AND m.role='owner')`;
        await sql`DELETE FROM users WHERE email=${email}`;
      }
      for (const name of createdWorkspaceNames) {
        await sql`DELETE FROM teams WHERE name=${name} AND id IN (SELECT team_id FROM team_members WHERE user_id=${e2eUsers.owner.id} AND role='owner')`;
      }
      for (const clientId of registeredClients) {
        await sql`DELETE FROM mcp_outbound_oauth_clients WHERE client_id=${clientId}`;
      }
    });
  } finally {
    await closeDb();
  }
});

test('signup and email verification resume the same agent authorization', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const registration = await page.request.post('/oauth/register', {
    data: {
      client_name: 'Coworker signup test',
      redirect_uris: ['http://127.0.0.1:9919/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(registration.status()).toBe(201);
  const client = (await registration.json()) as { client_id: string };
  registeredClients.push(client.client_id);
  const state = randomUUID();
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: 'http://127.0.0.1:9919/callback',
    scope: 'read',
    state,
    code_challenge: createHash('sha256').update(randomBytes(32)).digest('base64url'),
    code_challenge_method: 'S256',
    resource: `${baseURL}/api/mcp/server`,
  });
  await page.goto(`/oauth/authorize?${query}`);
  await page.getByRole('link', { name: 'Create one' }).click();
  const email = `coworker-${randomUUID()}@example.test`;
  createdEmails.push(email);
  await page.getByLabel('Name', { exact: true }).fill('New coworker owner');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Coworker-test-password-42!');
  await page.locator('input[name="legalAccepted"]').check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/oauth\/authorize/);
  expect(new URL(page.url()).searchParams.get('state')).toBe(state);
  await expect(page.getByRole('button', { name: 'Allow access' })).toBeVisible();
  const sql = getDbClient();
  const [delivery] =
    await sql`SELECT d.metadata FROM message_deliveries d JOIN users u ON u.id=d.user_id WHERE u.email=${email} AND d.intent='email_verification' ORDER BY d.created_at DESC LIMIT 1`;
  const encrypted = delivery!.metadata.email_payload_encrypted;
  const payload = decryptJson({
    ciphertext: Buffer.from(encrypted.ciphertext, 'base64'),
    iv: Buffer.from(encrypted.iv, 'base64'),
    tag: Buffer.from(encrypted.tag, 'base64'),
  }) as { text: string };
  const link = payload.text.match(/https?:\/\/[^\s<>]+\/verify-email\/[^\s<>]+/)?.[0];
  expect(link).toBeTruthy();
  expect(new URL(link!).searchParams.has('continuation')).toBe(true);
  expect(new URL(link!).searchParams.has('callbackUrl')).toBe(false);
  await page.goto(link!);
  await page.getByRole('link', { name: 'Continue connecting your agent' }).click();
  await expect(page).toHaveURL(/\/oauth\/authorize/);
  expect(new URL(page.url()).searchParams.get('state')).toBe(state);
});

test('owner provisions once, reads connection context, and manages reporting without expanding access', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, e2eUsers.owner.email, 120_000);
  await page.goto('/app/agent-provisioning');
  await page.getByLabel('Grant name').fill(`Browser coworker ${randomUUID()}`);
  await page.getByLabel('Allow the agent to capture notes in newly created workspaces').check();
  await page.getByRole('button', { name: 'Create provisioning grant' }).click();
  const token = await page.getByRole('status').locator('code').textContent();
  expect(token).toMatch(/^tlp_/);
  const headers = { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() };
  const data = {
    name: `Coworker browser ${randomUUID()}`,
    agentName: 'Browser coworker',
    timezone: 'UTC',
  };
  createdWorkspaceNames.push(data.name);
  const [created, retry] = await Promise.all([
    page.request.post('/api/agent/workspaces', { headers, data }),
    page.request.post('/api/agent/workspaces', { headers, data }),
  ]);
  expect(created.status()).toBe(201);
  expect(retry.status()).toBe(201);
  const result = await created.json();
  expect(await retry.json()).toEqual(result);
  expect(result.connection.scopes).toEqual(['read', 'capture']);
  const rpc = await page.request.post('/api/mcp/server', {
    headers: {
      Authorization: `Bearer ${result.credential}`,
      Accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'timeline.get', arguments: { kind: 'connection' } },
    },
  });
  expect(rpc.ok()).toBe(true);
  expect(await rpc.text()).toContain('on_request');
  async function callTool(name: string, args: Record<string, unknown>) {
    const response = await page.request.post('/api/mcp/server', {
      headers: {
        Authorization: `Bearer ${result.credential}`,
        Accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    });
    expect(response.ok()).toBe(true);
    const text = await response.text();
    const payload = JSON.parse(
      text.startsWith('event:') || text.startsWith('data:')
        ? text
            .split('\n')
            .find((line) => line.startsWith('data:'))!
            .slice(5)
        : text,
    );
    expect(payload.result?.isError).not.toBe(true);
    return payload.result.structuredContent;
  }
  const note = await callTool('timeline.remember', {
    text: 'Synthetic browser handoff: workspace connection verified. Next step: review reporting scope.',
    subject: 'Coworker acceptance',
  });
  expect(note.ok).toBe(true);
  expect(note.raw_event_id).toBeTruthy();
  const saved = await callTool('timeline.get', { kind: 'event', ref: note.raw_event_id });
  expect(JSON.stringify(saved)).toContain('Synthetic browser handoff');
  expect(note.citation).toContain(note.raw_event_id);
  // Change the primary team's agreement through the actual settings form.
  await page.goto('/app/connect-agent');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Workspace default', exact: true }) });
  await form.getByLabel('Reporting mode').selectOption('handoffs');
  await form.getByLabel('Project or work scope', { exact: false }).fill('Browser test project');
  await form.getByRole('button', { name: 'Save reporting preference' }).click();
  await expect(form.getByRole('status')).toHaveText('Reporting preference saved.');
});
