import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect((await scope().getChecklistState()).connectionCounts.outboundMcpKeys).toBe(1);
  });
});
