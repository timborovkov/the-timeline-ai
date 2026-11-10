import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { createOnboardingScope } from '#src/onboarding/index.js';
import { applyDbMigrations } from '#src/test/pglite.js';
/**
 * Onboarding checklist tests. The checklist is inferred from real workspace
 * state as well as explicit completion/dismissal rows, so these PGlite tests
 * protect the product contract without mocking the underlying tables.
 */

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_ID}', 'onboarding', 'Onboarding'),
      ('${OTHER_TEAM_ID}', 'other-onboarding', 'Other Onboarding');
    INSERT INTO users (id, email)
    VALUES
      ('${OWNER_ID}', 'owner@example.test'),
      ('${MEMBER_ID}', 'member@example.test');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_ID}', '${OWNER_ID}', 'owner'),
      ('${TEAM_ID}', '${MEMBER_ID}', 'member'),
      ('${OTHER_TEAM_ID}', '${OWNER_ID}', 'owner');
  `);
}

let pg: PGlite;
let db: Db;
let ensureMember: (minRole?: 'owner' | 'admin' | 'member') => Promise<'owner' | 'admin' | 'member'>;
let ensureMemberMock: ReturnType<typeof vi.fn<(minRole?: 'owner' | 'admin' | 'member') => void>>;

function scope(teamId = TEAM_ID, userId = OWNER_ID) {
  return createOnboardingScope({ db, teamId, userId, ensureMember });
}

function completedKeys(state: Awaited<ReturnType<ReturnType<typeof scope>['getChecklistState']>>) {
  return state.steps.filter((step) => step.completed).map((step) => step.step);
}

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seed(pg);
  db = drizzle(pg) as unknown as Db;
  ensureMemberMock = vi.fn<(minRole?: 'owner' | 'admin' | 'member') => void>();
  ensureMember = (minRole) => {
    ensureMemberMock(minRole);
    return Promise.resolve('owner');
  };
});

afterEach(async () => {
  await pg.close();
});

describe('onboarding checklist scope', () => {
  it('infers completed steps from source rows and connection state', async () => {
    await pg.exec(`
      INSERT INTO raw_events (team_id, author_user_id, source, content_text)
      VALUES
        ('${TEAM_ID}', '${OWNER_ID}', 'web', 'first note'),
        ('${TEAM_ID}', '${OWNER_ID}', 'email', 'forwarded email'),
        ('${OTHER_TEAM_ID}', '${OWNER_ID}', 'web', 'other note');
      INSERT INTO documents (id, team_id, owner_user_id, name, visibility)
      VALUES ('33333333-3333-4333-8333-333333333333', '${TEAM_ID}', '${OWNER_ID}', 'Plan', 'team');
      INSERT INTO telegram_users (id, tg_user_id, user_id)
      VALUES ('44444444-4444-4444-8444-444444444444', 12345, '${OWNER_ID}');
      INSERT INTO telegram_user_teams (telegram_user_id, team_id, linked_by_user_id, is_active)
      VALUES ('44444444-4444-4444-8444-444444444444', '${TEAM_ID}', '${OWNER_ID}', true);
      INSERT INTO slack_workspaces
        (id, slack_team_id, slack_enterprise_id, bot_user_id, token_ciphertext, token_iv, token_tag, installed_by_user_id)
      VALUES
        ('55555555-5555-4555-8555-555555555555', 'T123', NULL, 'Ubot', decode('aa','hex'), decode('bb','hex'), decode('cc','hex'), '${OWNER_ID}');
      INSERT INTO slack_workspace_teams (workspace_id, team_id, installed_by_user_id, enabled)
      VALUES ('55555555-5555-4555-8555-555555555555', '${TEAM_ID}', '${OWNER_ID}', true);
      INSERT INTO mcp_servers (team_id, added_by_user_id, name, url, auth_type, enabled)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'Docs MCP', 'https://mcp.example.test', 'none', true);
    `);

    const state = await scope().getChecklistState();

    expect(completedKeys(state)).toEqual([
      'first_note',
      'invite_teammate',
      'telegram',
      'slack',
      'email_forwarding',
      'first_document',
      'first_integration',
    ]);
    expect(state.connectionCounts).toMatchObject({
      telegramUserTeams: 1,
      slackWorkspaceTeams: 1,
      teamMcpServers: 1,
      activeMembers: 2,
    });
    expect(ensureMemberMock).toHaveBeenCalled();
  });

  it('keeps manual completion idempotent and scoped to the active team', async () => {
    await expect(scope().markStepComplete('first_note')).resolves.toBe(true);
    await expect(scope().markStepComplete('first_note')).resolves.toBe(false);
    await expect(scope(OTHER_TEAM_ID).markStepComplete('first_document')).resolves.toBe(true);

    expect(completedKeys(await scope().getChecklistState())).toEqual([
      'first_note',
      'invite_teammate',
    ]);
    expect(completedKeys(await scope(OTHER_TEAM_ID).getChecklistState())).toEqual([
      'first_document',
    ]);
  });

  it('counts non-web and ingest webhook events as the first timeline event', async () => {
    await pg.exec(`
      INSERT INTO raw_events (team_id, author_user_id, source, content_text)
      VALUES
        ('${TEAM_ID}', '${OWNER_ID}', 'telegram', 'captured from chat'),
        ('${OTHER_TEAM_ID}', '${OWNER_ID}', 'ingest_webhook', 'captured elsewhere');
    `);

    expect(completedKeys(await scope().getChecklistState())).toEqual([
      'first_note',
      'invite_teammate',
    ]);

    await pg.exec(`
      DELETE FROM raw_events WHERE team_id = '${TEAM_ID}';
      INSERT INTO raw_events (team_id, source, content_text)
      VALUES ('${TEAM_ID}', 'ingest_webhook', 'captured from webhook');
    `);

    expect(completedKeys(await scope().getChecklistState())).toEqual([
      'first_note',
      'invite_teammate',
    ]);
  });

  it('dismisses and reopens per user and team', async () => {
    await scope().dismissChecklist();

    await expect(scope().getChecklistState()).resolves.toMatchObject({ dismissed: true });
    await expect(scope(TEAM_ID, MEMBER_ID).getChecklistState()).resolves.toMatchObject({
      dismissed: false,
    });

    await scope().reopenChecklist();
    await expect(scope().getChecklistState()).resolves.toMatchObject({ dismissed: false });
  });

  it('infers teammate invite from a pending invite without a second member', async () => {
    await pg.exec(`
      INSERT INTO team_invites (team_id, email, token, invited_by_user_id, expires_at)
      VALUES (
        '${OTHER_TEAM_ID}',
        'new@example.test',
        'invite-token',
        '${OWNER_ID}',
        now() + interval '7 days'
      );
    `);

    expect(completedKeys(await scope(OTHER_TEAM_ID).getChecklistState())).toEqual([
      'invite_teammate',
    ]);
  });

  it('does not treat an expired invite as teammate setup', async () => {
    await pg.exec(`
      INSERT INTO team_invites (team_id, email, token, invited_by_user_id, expires_at)
      VALUES (
        '${OTHER_TEAM_ID}',
        'stale@example.test',
        'expired-invite-token',
        '${OWNER_ID}',
        now() - interval '1 day'
      );
    `);

    expect(completedKeys(await scope(OTHER_TEAM_ID).getChecklistState())).toEqual([]);
  });

  it('infers ask, meeting, proposal, digest, webhook, and outbound MCP steps', async () => {
    await pg.exec(`
      INSERT INTO chat_sessions (id, team_id, created_by)
      VALUES ('66666666-6666-4666-8666-666666666666', '${TEAM_ID}', '${OWNER_ID}');
      INSERT INTO chat_messages (team_id, session_id, role, content)
      VALUES (
        '${TEAM_ID}',
        '66666666-6666-4666-8666-666666666666',
        'user',
        '{"text":"what changed?"}'::jsonb
      );
      INSERT INTO meetings (team_id, platform, meeting_url)
      VALUES ('${TEAM_ID}', 'meet', 'https://meet.google.com/abc-defg-hij');
      INSERT INTO agent_suggestions (team_id, source, status, title, dedupe_key)
      VALUES ('${TEAM_ID}', 'background', 'accepted', 'Create follow-up', 'proposal-1');
      INSERT INTO daily_digests (team_id, user_id, window_start, window_end, summary)
      VALUES (
        '${TEAM_ID}',
        '${OWNER_ID}',
        '2026-08-17T00:00:00Z',
        '2026-08-17T23:59:59Z',
        'Morning summary'
      );
      INSERT INTO ingest_webhooks (team_id, name)
      VALUES ('${TEAM_ID}', 'Ops webhook');
    `);

    expect(completedKeys(await scope().getChecklistState())).toEqual([
      'invite_teammate',
      'first_ask',
      'first_meeting',
      'review_proposal',
      'daily_digest',
      'first_integration',
    ]);

    await pg.exec(`
      DELETE FROM ingest_webhooks WHERE team_id = '${TEAM_ID}';
      INSERT INTO mcp_outbound_keys (team_id, name, key_hash, key_prefix)
      VALUES ('${TEAM_ID}', 'Claude Desktop', 'abc123hash', 'tla_abc');
    `);

    expect(completedKeys(await scope().getChecklistState())).toContain('first_integration');
    expect(completedKeys(await scope().getChecklistState())).toContain('connect_agent');
    expect((await scope().getChecklistState()).connectionCounts.outboundMcpKeys).toBe(1);
  });

  it('infers connect_agent from an OAuth grant', async () => {
    await pg.exec(`
      INSERT INTO mcp_outbound_oauth_clients (client_id, client_name, redirect_uris)
      VALUES ('https://claude.ai/mcp', 'Claude', '["https://claude.ai/callback"]'::jsonb);
      INSERT INTO mcp_outbound_oauth_grants
        (client_id, team_id, user_id, membership_authorization_epoch, scopes, resource)
      VALUES (
        'https://claude.ai/mcp',
        '${TEAM_ID}',
        '${OWNER_ID}',
        gen_random_uuid(),
        '["read"]'::jsonb,
        'https://thetimeline.cc/api/mcp/server'
      );
    `);

    const state = await scope().getChecklistState();
    expect(completedKeys(state)).toContain('connect_agent');
    expect(state.connectionCounts.oauthGrants).toBe(1);
  });
});

it('infers billing setup only from this team active subscription, never a manual checkoff', async () => {
  expect(await scope().markStepComplete('billing_setup')).toBe(false);
  expect(completedKeys(await scope().getChecklistState())).not.toContain('billing_setup');
  await pg.exec(`
    INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, polar_subscription_id)
    VALUES ('${OTHER_TEAM_ID}', 'payg', 'payg_active', 'other-sub');
  `);
  expect(completedKeys(await scope().getChecklistState())).not.toContain('billing_setup');
  await pg.exec(`
    INSERT INTO team_billing_accounts (team_id, plan_id, billing_state)
    VALUES ('${TEAM_ID}', 'payg', 'payg_active');
  `);
  expect(completedKeys(await scope().getChecklistState())).not.toContain('billing_setup');
  await pg.exec(
    `UPDATE team_billing_accounts SET polar_subscription_id = 'this-sub' WHERE team_id = '${TEAM_ID}'`,
  );
  expect(completedKeys(await scope().getChecklistState())).toContain('billing_setup');
  for (const state of ['team_active', 'business_active', 'enterprise_active']) {
    await pg.exec(
      `UPDATE team_billing_accounts SET billing_state = '${state}' WHERE team_id = '${TEAM_ID}'`,
    );
    expect(completedKeys(await scope().getChecklistState())).toContain('billing_setup');
  }
  await pg.exec(
    `UPDATE team_billing_accounts SET billing_state = 'canceled' WHERE team_id = '${TEAM_ID}'`,
  );
  expect(completedKeys(await scope().getChecklistState())).not.toContain('billing_setup');
});

describe('first-run scope', () => {
  it('stores work style on the team and advances from welcome to choose', async () => {
    await pg.exec(`
      INSERT INTO team_first_run (team_id, started_by_user_id, phase)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'welcome');
    `);
    const next = await scope().submitWorkStyle('email');
    expect(next).not.toBeNull();
    expect(next?.phase).toBe('choose');
    expect(next?.workStyle).toBe('email');
  });

  it('skips to an empty home without creating a sample workspace', async () => {
    await pg.exec(`
      INSERT INTO team_first_run (team_id, started_by_user_id, phase)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'choose');
    `);
    const next = await scope().skipToEmptyHome();
    expect(next.phase).toBe('skipped');
    expect(next.starterPath).toBe('skip');
  });

  it('updates work style on an existing team without starting first-run', async () => {
    const next = await scope().submitWorkStyle('chat');
    expect(next).toBeNull();
    const workStyle = await pg.query(`SELECT work_style FROM teams WHERE id = '${TEAM_ID}'`);
    const row = workStyle.rows[0] as { work_style: string | null } | undefined;
    expect(row?.work_style).toBe('chat');
    const firstRun = await pg.query(
      `SELECT team_id FROM team_first_run WHERE team_id = '${TEAM_ID}'`,
    );
    expect(firstRun.rows).toHaveLength(0);
  });

  it('does not record a website scan failure after the starter path changes', async () => {
    await pg.exec(`
      INSERT INTO team_first_run (team_id, started_by_user_id, phase, starter_path)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'processing', 'email');
    `);
    const next = await scope().markScanFailed('robots');
    expect(next.phase).toBe('processing');
    expect(next.starterPath).toBe('email');
    expect(next.scanFailureReason).toBeNull();
  });

  it('does not let a stale document selection replace skip', async () => {
    await pg.exec(`
      INSERT INTO team_first_run (team_id, started_by_user_id, phase)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'choose');
    `);
    await scope().skipToEmptyHome();
    const next = await scope().selectStarterPath('document');
    expect(next.phase).toBe('skipped');
    expect(next.starterPath).toBe('skip');
  });

  it('keeps completed onboarding complete when a document capture refreshes', async () => {
    const documentId = '33333333-3333-4333-8333-333333333333';
    const eventId = '55555555-5555-4555-8555-555555555555';
    await pg.exec(`
      INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, visibility)
      VALUES ('${eventId}', '${TEAM_ID}', '${OWNER_ID}', 'web', 'deck', 'team');
      INSERT INTO documents (id, team_id, owner_user_id, name, visibility)
      VALUES ('${documentId}', '${TEAM_ID}', '${OWNER_ID}', 'Plan', 'team');
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, processing_status, source_event_id)
      VALUES ('66666666-6666-4666-8666-666666666666', '${TEAM_ID}', '${documentId}', 1, 'docs/plan-1', 'embedded', '${eventId}');
      INSERT INTO team_first_run (
        team_id, started_by_user_id, phase, starter_path, capture_document_id, capture_event_id, first_capture_landed_at
      )
      VALUES (
        '${TEAM_ID}', '${OWNER_ID}', 'complete', 'document', '${documentId}', '${eventId}', NOW()
      );
    `);
    const next = await scope().refreshDocumentCapture();
    expect(next?.phase).toBe('complete');
  });

  it('detects an email sent while the team address was already on the chooser', async () => {
    await pg.exec(`
      INSERT INTO team_first_run (
        team_id, started_by_user_id, phase, starter_path, starter_selected_at, created_at
      )
      VALUES (
        '${TEAM_ID}', '${OWNER_ID}', 'processing', 'email', NOW(), NOW() - INTERVAL '1 hour'
      );
      INSERT INTO raw_events (team_id, author_user_id, source, content_text, visibility, created_at)
      VALUES (
        '${TEAM_ID}', '${OWNER_ID}', 'email', 'Subject: kickoff', 'team', NOW() - INTERVAL '10 minutes'
      );
    `);
    const arrival = await scope().detectEmailArrival();
    expect(arrival.arrived).toBe(true);
    expect(arrival.eventId).toBeTruthy();
  });

  it('hides a teammate private email from first-run capture reads', async () => {
    await pg.exec(`
      INSERT INTO team_first_run (
        team_id, started_by_user_id, phase, starter_path, created_at
      )
      VALUES (
        '${TEAM_ID}', '${OWNER_ID}', 'processing', 'email', NOW() - INTERVAL '1 hour'
      );
      INSERT INTO raw_events (
        team_id, author_user_id, visibility_owner_user_id, source, content_text, visibility, created_at
      )
      VALUES (
        '${TEAM_ID}', '${MEMBER_ID}', '${MEMBER_ID}', 'email', 'private thread', 'private', NOW()
      );
    `);
    const arrival = await scope().detectEmailArrival();
    expect(arrival.arrived).toBe(false);
    const record = await scope().getFirstRunRecord();
    expect(record?.summary).toBeNull();
    expect(record?.emailArrived).toBe(false);
  });

  it('hides a private proposal that cites a team-visible starter event', async () => {
    const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
    const suggestionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
    const itemId = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
    await pg.exec(`
      INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, visibility)
      VALUES ('${eventId}', '${TEAM_ID}', '${OWNER_ID}', 'email', 'kickoff thread', 'team');
      INSERT INTO agent_suggestions (
        id, team_id, source, status, title, dedupe_key, visibility, visibility_owner_user_id
      )
      VALUES (
        '${suggestionId}', '${TEAM_ID}', 'background', 'pending', 'Secret person',
        'first-run-private-person', 'private', '${MEMBER_ID}'
      );
      INSERT INTO agent_suggestion_items (
        id, suggestion_id, team_id, operation, target_kind, title, dedupe_key, proposed_payload
      )
      VALUES (
        '${itemId}', '${suggestionId}', '${TEAM_ID}', 'create', 'object', 'Dana Reyes',
        'person-dana', '{"type":"person","name":"Dana Reyes"}'::jsonb
      );
      INSERT INTO agent_suggestion_evidence (suggestion_id, team_id, raw_event_id)
      VALUES ('${suggestionId}', '${TEAM_ID}', '${eventId}');
      INSERT INTO team_first_run (
        team_id, started_by_user_id, phase, starter_path, capture_event_id
      )
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'record', 'email', '${eventId}');
    `);
    const ownerRecord = await scope().getFirstRunRecord();
    const memberRecord = await scope(TEAM_ID, MEMBER_ID).getFirstRunRecord();
    expect(ownerRecord?.suggestions).toEqual([]);
    expect(memberRecord?.suggestions.map((item) => item.title)).toContain('Dana Reyes');
  });

  it('does not mark a failed document extract as landed', async () => {
    const documentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
    await pg.exec(`
      INSERT INTO documents (id, team_id, owner_user_id, name, visibility)
      VALUES ('${documentId}', '${TEAM_ID}', '${OWNER_ID}', 'Empty.txt', 'team');
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, processing_status)
      VALUES (
        'ffffffff-ffff-4fff-8fff-ffffffffff01', '${TEAM_ID}', '${documentId}', 1, 'docs/empty', 'failed'
      );
      INSERT INTO team_first_run (
        team_id, started_by_user_id, phase, starter_path, capture_document_id
      )
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'processing', 'document', '${documentId}');
    `);
    const next = await scope().refreshDocumentCapture();
    expect(next?.phase).toBe('processing');
    expect(next?.firstCaptureLandedAt).toBeNull();
    const record = await scope().getFirstRunRecord();
    expect(record?.processingSteps.some((step) => step.status === 'failed')).toBe(true);
  });

  it('reads starter document chunks only from the selected version', async () => {
    const documentId = '77777777-7777-4777-8777-777777777777';
    const oldVersionId = '88888888-8888-4888-8888-888888888888';
    const newVersionId = '99999999-9999-4999-8999-999999999999';
    const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
    await pg.exec(`
      INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, visibility)
      VALUES ('${eventId}', '${TEAM_ID}', '${OWNER_ID}', 'web', 'deck', 'team');
      INSERT INTO documents (id, team_id, owner_user_id, name, visibility)
      VALUES ('${documentId}', '${TEAM_ID}', '${OWNER_ID}', 'Plan', 'team');
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, processing_status, source_event_id)
      VALUES
        ('${oldVersionId}', '${TEAM_ID}', '${documentId}', 1, 'docs/plan-1', 'embedded', '${eventId}'),
        ('${newVersionId}', '${TEAM_ID}', '${documentId}', 2, 'docs/plan-2', 'embedded', '${eventId}');
      INSERT INTO document_chunks (
        team_id, document_id, document_version_id, chunk_index, text, token_count
      )
      VALUES
        ('${TEAM_ID}', '${documentId}', '${oldVersionId}', 0, 'obsolete draft text that should stay hidden', 8),
        ('${TEAM_ID}', '${documentId}', '${newVersionId}', 0, 'latest cited deck summary', 5);
      INSERT INTO team_first_run (
        team_id, started_by_user_id, phase, starter_path, capture_document_id
      )
      VALUES (
        '${TEAM_ID}', '${OWNER_ID}', 'record', 'document', '${documentId}'
      );
    `);
    const record = await scope().getFirstRunRecord();
    expect(record?.summary).toContain('latest cited deck summary');
    expect(record?.summary).not.toContain('obsolete draft');
  });
});

it('treats an active comp as billing setup but not an expired comp', async () => {
  await pg.exec(`INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, arrangement, comp_expires_at)
    VALUES ('${TEAM_ID}', 'team', 'team_active', 'comped', NOW() + INTERVAL '1 day')`);
  expect(completedKeys(await scope().getChecklistState())).toContain('billing_setup');
  await pg.exec(
    `UPDATE team_billing_accounts SET comp_expires_at = NOW() - INTERVAL '1 day' WHERE team_id = '${TEAM_ID}'`,
  );
  expect(completedKeys(await scope().getChecklistState())).not.toContain('billing_setup');
});
