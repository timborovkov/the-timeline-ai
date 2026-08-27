import { randomBytes } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import {
  chatSessions,
  chatSurfaceTurns,
  meetingCaptureConfirmations,
  meetings,
  rawEvents,
  reconciliationEvidence,
  savedMeetingAliases,
  savedMeetings,
  slackConversationBindings,
  slackUsers,
  slackUserTeams,
  slackWorkspaces,
  slackWorkspaceTeams,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueueModule from '#src/queue/queues.js';

import { encryptJson, resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import { resetMeetingBotProviderForTests } from '#src/meeting-bots/index.js';
import {
  bindSlackConversation,
  handleSlackEnvelope,
  handleSlackSlashCommand,
  linkSlackUserFromOAuth,
  unbindSlackConversation,
} from '#src/slack/dispatcher.js';
import { applyDbMigrations } from '#src/test/pglite.js';
import { textQueueDeps } from '#src/test/queue-deps.js';

vi.mock('#src/queue/queues.js', async (importOriginal) => ({
  ...(await importOriginal<typeof QueueModule>()),
  enqueueConversationAgentJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'turn' }),
}));

const askAgentMock = vi.hoisted(() => vi.fn());

vi.mock('#src/http/external-fetch.js', () => ({
  externalFetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

vi.mock('#src/agent/ask.js', () => ({
  askAgent: askAgentMock,
  TEAM_BOT_ACTOR_USER_ID: '00000000-0000-0000-0000-000000000000',
}));

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';
const SLACK_USER_ROW_ID = '44444444-4444-4444-4444-444444444444';

async function seedTeams(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_A}', 'team-a', 'Team A'), ('${TEAM_B}', 'team-b', 'Team B');
    INSERT INTO users (id, email, name)
    VALUES
      ('${USER_A}', 'a@example.com', 'Alice'),
      ('${USER_B}', 'b@example.com', 'Bob');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${USER_A}', 'owner'),
      ('${TEAM_B}', '${USER_B}', 'owner');
  `);
}

async function seedWorkspace(db: ReturnType<typeof drizzle>, teamId = TEAM_A): Promise<void> {
  const token = encryptJson({ accessToken: 'xoxb-test' });
  await db.insert(slackWorkspaces).values({
    id: WORKSPACE_ID,
    slackTeamId: 'T_SLACK',
    name: 'Acme Slack',
    botUserId: 'U_BOT',
    tokenCiphertext: token.ciphertext,
    tokenIv: token.iv,
    tokenTag: token.tag,
    installedByUserId: teamId === TEAM_A ? USER_A : USER_B,
  });
  await db.insert(slackWorkspaceTeams).values({
    workspaceId: WORKSPACE_ID,
    teamId,
    installedByUserId: teamId === TEAM_A ? USER_A : USER_B,
    enabled: true,
  });
}

function slackEnvelope(eventId: string, event: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'event_callback',
    team_id: 'T_SLACK',
    event_id: eventId,
    event_time: 1_700_000_000,
    event,
  };
}

function installFetchMock(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    if (href.includes('users.info')) {
      return Promise.resolve(
        Response.json({
          ok: true,
          user: {
            id: 'U_SLACK',
            name: 'alice',
            real_name: 'Alice Slack',
            profile: { display_name: 'Alice Slack', real_name: 'Alice Slack' },
          },
        }),
      );
    }
    if (href.includes('conversations.info')) {
      const params =
        _init?.body instanceof URLSearchParams
          ? _init.body
          : new URLSearchParams(typeof _init?.body === 'string' ? _init.body : '');
      const channel = params.get('channel') ?? '';
      return Promise.resolve(
        Response.json({
          ok: true,
          channel: { id: channel, is_im: channel.startsWith('D') },
        }),
      );
    }
    if (href.includes('reactions.add') || href.includes('chat.postMessage')) {
      return Promise.resolve(Response.json({ ok: true }));
    }
    if (href.includes('files.example')) {
      return Promise.resolve(
        new Response(Buffer.from('%PDF-1.7'), {
          headers: { 'content-type': 'application/pdf' },
        }),
      );
    }
    if (href.includes('recall.test')) {
      return Promise.resolve(Response.json({ id: 'bot-slack-1' }));
    }
    return Promise.resolve(Response.json({ ok: true }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function seedBoundSlackUser(
  db: ReturnType<typeof drizzle>,
  channelId = 'C_DOCS',
): Promise<void> {
  await seedWorkspace(db, TEAM_A);
  await db.insert(slackConversationBindings).values({
    workspaceId: WORKSPACE_ID,
    teamId: TEAM_A,
    slackConversationId: channelId,
    conversationType: 'channel',
    title: 'docs',
    boundByUserId: USER_A,
    enabled: true,
  });
  await db.insert(slackUsers).values({
    id: SLACK_USER_ROW_ID,
    workspaceId: WORKSPACE_ID,
    slackUserId: 'U_SLACK',
    realName: 'Alice Slack',
  });
  await db.insert(slackUserTeams).values({
    slackUserId: SLACK_USER_ROW_ID,
    teamId: TEAM_A,
    userId: USER_A,
    linkedByUserId: USER_A,
    isActive: true,
  });
}

async function seedSavedMeeting(db: ReturnType<typeof drizzle>, alias = 'daily'): Promise<string> {
  const [saved] = await db
    .insert(savedMeetings)
    .values({
      teamId: TEAM_A,
      createdByUserId: USER_A,
      title: 'Internal daily meeting',
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/slack-saved-test',
      permissionConfirmedAt: new Date(),
      permissionConfirmedByUserId: USER_A,
      durationMinutes: 30,
      autoJoinEnabled: false,
    })
    .returning();
  if (!saved) throw new Error('expected saved meeting');
  await db.insert(savedMeetingAliases).values({
    savedMeetingId: saved.id,
    teamId: TEAM_A,
    alias,
    normalizedAlias: alias,
  });
  return saved.id;
}

function fetchBodyContaining(fetchMock: ReturnType<typeof vi.fn>, needle: string): string | null {
  for (const [, init] of fetchMock.mock.calls as [unknown, RequestInit | undefined][]) {
    const body = init?.body;
    const text =
      typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : null;
    if (text?.includes(needle)) return text;
  }
  return null;
}

function responseBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return (fetchMock.mock.calls as [unknown, RequestInit | undefined][])
    .filter(([url]) => url === 'https://hooks.slack.test/response')
    .map(([, init]) => {
      const body = init?.body;
      if (typeof body !== 'string') return {};
      return JSON.parse(body) as Record<string, unknown>;
    });
}

describe('Slack dispatcher routing', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    process.env.AUTH_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.AUTH_URL = 'https://timeline.test';
    process.env.RECALL_API_KEY = 'recall-test-key';
    process.env.RECALL_BASE_URL = 'https://recall.test/api/v1';
    process.env.RECALL_WORKSPACE_VERIFICATION_SECRET = `whsec_${Buffer.from('slack-workspace-for-tests').toString('base64')}`;
    resetEnvForTests();
    resetMeetingBotProviderForTests();
    resetSecretsKeyCacheForTests();
    askAgentMock.mockReset();
    askAgentMock.mockResolvedValue({ ok: true, answer: 'answer' });
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seedTeams(pg);
    db = drizzle(pg);
    installFetchMock();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetMeetingBotProviderForTests();
    await pg.close();
  });

  it('rejects user linking when the receiving team did not install that Slack workspace', async () => {
    await seedWorkspace(db, TEAM_A);

    await expect(
      linkSlackUserFromOAuth({
        db: db as never,
        teamId: TEAM_B,
        userId: USER_B,
        oauth: { ok: true, team: { id: 'T_SLACK' }, authed_user: { id: 'U_SLACK' } },
      }),
    ).rejects.toThrow('slack_workspace_not_installed');
  });

  it('re-enables an existing disabled Slack conversation binding on rebind', async () => {
    await seedWorkspace(db, TEAM_A);

    await bindSlackConversation({
      db: db as never,
      teamId: TEAM_A,
      userId: USER_A,
      conversationId: 'C_REBIND',
    });
    const first = await db
      .select({ id: slackConversationBindings.id })
      .from(slackConversationBindings)
      .where(eq(slackConversationBindings.slackConversationId, 'C_REBIND'));
    expect(first).toHaveLength(1);
    const firstBinding = first[0];
    if (!firstBinding) throw new Error('expected slack binding');

    await unbindSlackConversation({ db: db as never, teamId: TEAM_A, bindingId: firstBinding.id });
    await bindSlackConversation({
      db: db as never,
      teamId: TEAM_A,
      userId: USER_A,
      conversationId: 'C_REBIND',
    });

    const rows = await db
      .select({ id: slackConversationBindings.id, enabled: slackConversationBindings.enabled })
      .from(slackConversationBindings)
      .where(eq(slackConversationBindings.slackConversationId, 'C_REBIND'));
    expect(rows).toEqual([{ id: firstBinding.id, enabled: true }]);
  });

  it('does not answer app mentions in unbound Slack channels', async () => {
    const fetchMock = installFetchMock();
    await seedWorkspace(db, TEAM_A);

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvMention', {
        type: 'app_mention',
        channel: 'C_PUBLIC',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '<@U_BOT> what happened?',
        ts: '1700000000.000100',
      }),
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('chat.postMessage'),
      expect.anything(),
    );
  });

  it('rejects event callbacks without a Slack team_id', async () => {
    const result = await handleSlackEnvelope(
      { db: db as never },
      {
        type: 'event_callback',
        event_id: 'EvMissingTeam',
        event_time: 1_700_000_000,
        event: {
          type: 'message',
          channel: 'C_DOCS',
          channel_type: 'channel',
          user: 'U_SLACK',
          text: 'hello',
          ts: '1700000000.000100',
        },
      },
    );

    expect(result).toEqual({ ok: false });
  });

  it('tombstones Slack source deletes before bot message filtering', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(rawEvents).values({
      teamId: TEAM_A,
      authorUserId: USER_A,
      source: 'slack',
      contentText: 'captured before bot metadata was known',
      sourceMetadata: {
        slack_workspace_id: WORKSPACE_ID,
        slack_channel_id: 'C_DOCS',
        slack_message_ts: '1700000000.000400',
      },
    });

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvBotDelete', {
        type: 'message',
        subtype: 'message_deleted',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_BOT',
        bot_id: 'B_BOT',
        ts: '1700000001.000400',
        deleted_ts: '1700000000.000400',
      }),
    );

    const rows = await db
      .select({ metadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.source, 'slack'));
    expect(rows[0]?.metadata).toMatchObject({
      deleted: true,
      delete_reason: 'slack_deleted_at_source',
    });
  });

  it('does not call the agent for a bare app mention', async () => {
    const fetchMock = installFetchMock();
    await seedBoundSlackUser(db, 'C_MENTIONS');

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvMentionBare', {
        type: 'app_mention',
        channel: 'C_MENTIONS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '<@U_BOT>',
        ts: '1700000000.000200',
      }),
    );

    expect(askAgentMock).not.toHaveBeenCalled();
    expect(
      fetchBodyContaining(fetchMock, 'Ask+a+question+after+mentioning+Timeline'),
    ).not.toBeNull();
  });

  it('posts an app mention failure follow-up when the agent throws', async () => {
    const fetchMock = installFetchMock();
    askAgentMock.mockRejectedValueOnce(new Error('model offline'));
    await seedBoundSlackUser(db, 'C_MENTIONS');

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvMentionFailure', {
        type: 'app_mention',
        channel: 'C_MENTIONS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '<@U_BOT> what changed?',
        ts: '1700000000.000300',
      }),
    );

    expect(
      fetchBodyContaining(fetchMock, 'Timeline+could+not+answer+that+right+now.'),
    ).not.toBeNull();
  });

  it('preserves cached Slack profile fields when users.info returns no user', async () => {
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (href.includes('users.info')) return Promise.resolve(Response.json({ ok: true }));
      if (href.includes('reactions.add') || href.includes('chat.postMessage')) {
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await seedBoundSlackUser(db, 'C_DOCS');

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvNullProfile', {
        type: 'message',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'hello',
        ts: '1700000000.000300',
      }),
    );

    const rows = await db
      .select({ name: slackUsers.name, realName: slackUsers.realName })
      .from(slackUsers)
      .where(eq(slackUsers.id, SLACK_USER_ROW_ID));
    expect(rows[0]).toMatchObject({ name: null, realName: 'Alice Slack' });
  });

  it('captures bound channel text with linked sender attribution, visibility, and text queues', async () => {
    await seedBoundSlackUser(db);
    const queues = textQueueDeps();

    await handleSlackEnvelope(
      { db: db as never, ...queues },
      slackEnvelope('EvChannelText', {
        type: 'message',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'Slack capture should become approval work',
        ts: '1700000000.000500',
      }),
    );

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamId: TEAM_A,
      authorUserId: USER_A,
      contentText: 'Slack capture should become approval work',
      visibility: 'team',
    });
    const metadata = rows[0]?.sourceMetadata as Record<string, unknown> | undefined;
    expect(metadata).toMatchObject({
      slack_event_id: 'EvChannelText',
      slack_channel_id: 'C_DOCS',
      slack_sender_id: 'U_SLACK',
      slack_sender_name: 'Alice Slack',
      slack_sender_timeline_user_id: USER_A,
      source_payload_ref: `inline://timeline/slack/${WORKSPACE_ID}/EvChannelText`,
      source_snapshot_kind: 'slack_message_event',
      source_snapshot_version: 'slack-source-snapshot-2026-07',
      source_unverified: false,
    });
    expect(metadata?.payload_digest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(metadata?.source_snapshot).toMatchObject({
      slack_event_id: 'EvChannelText',
      channel_id: 'C_DOCS',
      message_ts: '1700000000.000500',
      text: 'Slack capture should become approval work',
    });
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        eq(
          reconciliationEvidence.rawEventId,
          rows[0]?.id ?? '00000000-0000-0000-0000-000000000000',
        ),
      );
    expect(evidence).toMatchObject({
      source: 'slack',
      provider: 'slack',
      externalObjectId: `${WORKSPACE_ID}:C_DOCS:1700000000.000500`,
      eventType: 'slack.message',
      replayState: 'full',
      sourcePayloadRef: `inline://timeline/slack/${WORKSPACE_ID}/EvChannelText`,
      visibility: 'team',
    });
    expect(evidence?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(queues.extract.enqueueExtract).toHaveBeenCalledWith({
      rawEventId: rows[0]?.id,
      teamId: TEAM_A,
    });
    expect(queues.embed.enqueueEmbed).toHaveBeenCalledWith({
      rawEventId: rows[0]?.id,
      teamId: TEAM_A,
    });
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenCalledWith({
      rawEventId: rows[0]?.id,
      teamId: TEAM_A,
    });
  });

  it('captures Slack shared links as metadata and provider-matchable artifact evidence', async () => {
    await seedBoundSlackUser(db);

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvChannelLink', {
        type: 'message',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'Discuss <https://github.com/timborovkov/the-timeline-ai/pull/202?utm_source=slack|PR 202> with ada@example.com',
        ts: '1700000000.000550',
      }),
    );

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceMetadata).toMatchObject({
      links: [
        {
          canonical_url: 'https://github.com/timborovkov/the-timeline-ai/pull/202',
          display_url: 'github.com/timborovkov/the-timeline-ai/pull/202',
          domain: 'github.com',
          label: 'PR 202',
          provider: 'github',
          provider_object_id: 'timborovkov/the-timeline-ai#202',
        },
      ],
      contacts: {
        emails: [expect.objectContaining({ normalized_value: 'ada@example.com' })],
        phones: [],
        addresses: [],
      },
    });

    const artifacts = await pg.query<{
      artifact_type: string;
      canonical_name: string;
      raw_event_id: string;
      provider: string | null;
      external_object_id: string | null;
      strength: string;
      anchor_type: string;
      anchor_value: string;
    }>(`
      SELECT ac.artifact_type, ac.canonical_name, aea.raw_event_id,
             aea.metadata ->> 'provider' AS provider,
             aea.metadata ->> 'external_object_id' AS external_object_id,
             aea.strength, aca.anchor_type, aca.anchor_value
      FROM artifact_clusters ac
      JOIN artifact_evidence_associations aea ON aea.cluster_id = ac.id
      JOIN artifact_cluster_anchors aca ON aca.cluster_id = ac.id
      WHERE ac.team_id = '${TEAM_A}'
      ORDER BY aca.anchor_type
    `);
    expect(artifacts.rows).toEqual([
      {
        artifact_type: 'link',
        canonical_name: 'PR 202 (github.com/timborovkov/the-timeline-ai/pull/202)',
        raw_event_id: rows[0]?.id,
        provider: 'github',
        external_object_id: 'timborovkov/the-timeline-ai#202',
        strength: 'structured',
        anchor_type: 'provider_external:github',
        anchor_value: 'timborovkov/the-timeline-ai#202',
      },
      {
        artifact_type: 'link',
        canonical_name: 'PR 202 (github.com/timborovkov/the-timeline-ai/pull/202)',
        raw_event_id: rows[0]?.id,
        provider: 'github',
        external_object_id: 'timborovkov/the-timeline-ai#202',
        strength: 'structured',
        anchor_type: 'url:canonical',
        anchor_value: 'https://github.com/timborovkov/the-timeline-ai/pull/202',
      },
      {
        artifact_type: 'link',
        canonical_name: 'PR 202 (github.com/timborovkov/the-timeline-ai/pull/202)',
        raw_event_id: rows[0]?.id,
        provider: 'github',
        external_object_id: 'timborovkov/the-timeline-ai#202',
        strength: 'structured',
        anchor_type: 'url:display',
        anchor_value: 'github.com/timborovkov/the-timeline-ai/pull/202',
      },
    ]);
  });

  it('repairs missing link artifacts when Slack retries an already-inserted event', async () => {
    await seedBoundSlackUser(db);
    const envelope = slackEnvelope('EvChannelLinkRetry', {
      type: 'message',
      channel: 'C_DOCS',
      channel_type: 'channel',
      user: 'U_SLACK',
      text: 'Spec https://example.com/spec',
      ts: '1700000000.000560',
    });

    await handleSlackEnvelope({ db: db as never }, envelope);
    await pg.exec(`
      DELETE FROM artifact_evidence_associations;
      DELETE FROM artifact_cluster_members;
      DELETE FROM artifact_cluster_anchors;
      DELETE FROM artifact_clusters;
    `);
    await handleSlackEnvelope({ db: db as never }, envelope);

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(rows).toHaveLength(1);
    const artifacts = await pg.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM artifact_evidence_associations
      WHERE raw_event_id = (SELECT id FROM raw_events WHERE source = 'slack')
    `);
    expect(artifacts.rows[0]?.count).toBe('1');
  });

  it('queues linked Slack DM text as a durable agent conversation', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    const fetchMock = installFetchMock();

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvDmText', {
        type: 'message',
        channel: 'D_SLACK',
        channel_type: 'im',
        user: 'U_SLACK',
        text: 'DM follow up with Ada next week',
        ts: '1700000000.000600',
      }),
    );

    expect(await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'))).toHaveLength(0);
    expect(await db.select().from(chatSurfaceTurns)).toMatchObject([
      {
        surface: 'slack',
        externalEventId: 'EvDmText',
        externalMessageId: '1700000000.000600',
        externalConversationKey: `workspace:${WORKSPACE_ID}:dm:D_SLACK`,
        teamId: TEAM_A,
        userId: USER_A,
        questionText: 'DM follow up with Ada next week',
        status: 'queued',
      },
    ]);
    expect(await db.select().from(chatSessions)).toMatchObject([
      {
        surface: 'slack',
        title: 'DM follow up with Ada next week',
        createdBy: USER_A,
      },
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('reactions.add'))).toBe(true);
  });

  it('queues a Slack DM without waiting for a slow profile lookup or reaction', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Cached Alice',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    let releaseSlackApi: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            releaseSlackApi = () => {
              resolve(Response.json({ ok: true }));
            };
          }),
      ),
    );

    const handled = handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvSlowDmText', {
        type: 'message',
        channel: 'D_SLACK',
        channel_type: 'im',
        user: 'U_SLACK',
        text: 'Answer without blocking the webhook',
        ts: '1700000000.000601',
      }),
    );
    const result = await Promise.race([
      handled,
      new Promise<'still-pending'>((resolve) => {
        setTimeout(() => {
          resolve('still-pending');
        }, 50);
      }),
    ]);
    releaseSlackApi?.();

    expect(result).toEqual({ ok: true });
    expect(await db.select().from(chatSurfaceTurns)).toMatchObject([
      { externalEventId: 'EvSlowDmText', status: 'queued' },
    ]);
  });

  it('lists only active memberships enabled for the current Slack workspace', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_B}', '${USER_A}', 'member');
    `);
    const fetchMock = installFetchMock();
    const input = {
      command: '/timeline',
      text: 'team',
      user_id: 'U_SLACK',
      team_id: 'T_SLACK',
      channel_id: 'D_SLACK',
      response_url: 'https://hooks.slack.test/response',
      trigger_id: 'trigger-team-list',
    };

    await handleSlackSlashCommand({ db: db as never }, input);
    expect(JSON.stringify(responseBodies(fetchMock))).toContain('Team A');
    expect(JSON.stringify(responseBodies(fetchMock))).not.toContain('Team B');

    await db.insert(slackWorkspaceTeams).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_B,
      installedByUserId: USER_A,
      enabled: true,
    });
    fetchMock.mockClear();
    await handleSlackSlashCommand({ db: db as never }, input);
    expect(JSON.stringify(responseBodies(fetchMock))).toContain('Team B');
  });

  it('lets a verified Slack user recover when the previously active team is no longer eligible', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackWorkspaceTeams).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_B,
      installedByUserId: USER_A,
      enabled: true,
    });
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_B}', '${USER_A}', 'member');
    `);
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    await db
      .update(slackWorkspaceTeams)
      .set({ enabled: false })
      .where(eq(slackWorkspaceTeams.teamId, TEAM_A));
    const fetchMock = installFetchMock();
    const input = {
      command: '/timeline',
      text: 'team',
      user_id: 'U_SLACK',
      team_id: 'T_SLACK',
      channel_id: 'D_SLACK',
      response_url: 'https://hooks.slack.test/response',
      trigger_id: 'trigger-team-recovery',
    };

    await handleSlackSlashCommand({ db: db as never }, input);
    expect(JSON.stringify(responseBodies(fetchMock))).toContain('Team B');
    expect(JSON.stringify(responseBodies(fetchMock))).not.toContain('Link your Slack identity');

    fetchMock.mockClear();
    await handleSlackSlashCommand({ db: db as never }, { ...input, text: 'team 1' });
    expect(JSON.stringify(responseBodies(fetchMock))).toContain('Active team is now Team B');
    expect(await db.select().from(slackUserTeams)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ teamId: TEAM_B, userId: USER_A, isActive: true }),
      ]),
    );
  });

  it('captures explicit /timeline note text instead of invoking the agent', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    const queues = textQueueDeps();

    await handleSlackSlashCommand(
      { db: db as never, ...queues },
      {
        command: '/timeline',
        text: 'note Follow up with Ada on Friday',
        user_id: 'U_SLACK',
        team_id: 'T_SLACK',
        channel_id: 'D_SLACK',
        response_url: 'https://hooks.slack.test/response',
        trigger_id: 'trigger-note',
      },
    );

    expect(await db.select().from(chatSurfaceTurns)).toHaveLength(0);
    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(rows).toMatchObject([
      {
        teamId: TEAM_A,
        authorUserId: USER_A,
        contentText: 'Follow up with Ada on Friday',
      },
    ]);
    expect(queues.extract.enqueueExtract).toHaveBeenCalledOnce();
    expect(queues.embed.enqueueEmbed).toHaveBeenCalledOnce();
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenCalledOnce();
  });

  it('does not capture or enqueue work for unbound channel messages', async () => {
    await seedWorkspace(db, TEAM_A);
    const queues = textQueueDeps();

    await handleSlackEnvelope(
      { db: db as never, ...queues },
      slackEnvelope('EvUnboundText', {
        type: 'message',
        channel: 'C_UNBOUND',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'should not land',
        ts: '1700000000.000700',
      }),
    );

    const rows = await db.select().from(rawEvents);
    expect(rows).toHaveLength(0);
    expect(queues.extract.enqueueExtract).not.toHaveBeenCalled();
    expect(queues.embed.enqueueEmbed).not.toHaveBeenCalled();
    expect(queues.suggestions.enqueueSuggestion).not.toHaveBeenCalled();
  });

  it('answers app mentions without recording them as capture events', async () => {
    await seedBoundSlackUser(db, 'C_MENTIONS');
    const queues = textQueueDeps();

    await handleSlackEnvelope(
      { db: db as never, ...queues },
      slackEnvelope('EvMentionQuestion', {
        type: 'app_mention',
        channel: 'C_MENTIONS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '<@U_BOT> what changed?',
        ts: '1700000000.000800',
      }),
    );

    expect(askAgentMock).toHaveBeenCalledOnce();
    const rows = await db.select().from(rawEvents);
    expect(rows).toHaveLength(0);
    expect(queues.suggestions.enqueueSuggestion).not.toHaveBeenCalled();
  });

  it('answers bound channel app mentions from unlinked Slack users as the team bot actor', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_A,
      slackConversationId: 'C_MENTIONS',
      conversationType: 'channel',
      title: 'mentions',
      boundByUserId: USER_A,
      enabled: true,
    });

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvMentionUnlinkedQuestion', {
        type: 'app_mention',
        channel: 'C_MENTIONS',
        channel_type: 'channel',
        user: 'U_UNLINKED',
        text: '<@U_BOT> what changed?',
        ts: '1700000000.000801',
      }),
    );

    expect(askAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        userId: '00000000-0000-0000-0000-000000000000',
        deliverySurface: 'slack',
        trustedTeamActor: true,
        toolMode: 'proposal_only',
        proposalOrigin: { surface: 'slack', actorKind: 'team_agent' },
        question: 'what changed?',
      }),
      expect.objectContaining({ includeMcpTools: true }),
    );
  });

  it('captures Slack file_share messages and enqueues document extraction', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_A,
      slackConversationId: 'C_DOCS',
      conversationType: 'channel',
      title: 'docs',
      boundByUserId: USER_A,
      enabled: true,
    });
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const queues = textQueueDeps();

    await handleSlackEnvelope(
      {
        db: db as never,
        ...queues,
        documents: { upload, enqueueExtract },
      },
      slackEnvelope('EvFile', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '',
        ts: '1700000001.000100',
        files: [
          {
            id: 'F1',
            name: 'plan.pdf',
            mimetype: 'application/pdf',
            size: 8,
            url_private_download: 'https://files.example/plan.pdf',
          },
        ],
      }),
    );

    expect(upload).toHaveBeenCalledOnce();
    expect(enqueueExtract).toHaveBeenCalledOnce();
    expect(queues.extract.enqueueExtract).not.toHaveBeenCalled();
    expect(queues.embed.enqueueEmbed).not.toHaveBeenCalled();
    expect(queues.suggestions.enqueueSuggestion).not.toHaveBeenCalled();
    const eventRows = await pg.query(`SELECT id FROM raw_events WHERE source = 'document'`);
    expect(eventRows.rows).toHaveLength(0);
    const rows = await pg.query<{
      file_kind: string;
      folder_id: string | null;
      source_raw_event_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT file_kind, folder_id, source_raw_event_id, metadata
       FROM documents
       WHERE name = 'plan.pdf'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.file_kind).toBe('captured');
    expect(rows.rows[0]?.folder_id).toBeNull();
    expect(rows.rows[0]?.source_raw_event_id).toBeTruthy();
    expect(rows.rows[0]?.metadata).toMatchObject({
      source: 'slack',
      slack_file_id: 'F1',
    });
  });

  it('stores the binding owner on private captured files from unlinked Slack senders', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_A,
      slackConversationId: 'C_PRIVATE',
      conversationType: 'channel',
      title: 'private-docs',
      boundByUserId: USER_A,
      visibilityDefault: 'private',
      enabled: true,
    });
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const queues = textQueueDeps();

    await handleSlackEnvelope(
      {
        db: db as never,
        ...queues,
        documents: { upload, enqueueExtract },
      },
      slackEnvelope('EvPrivateFile', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_PRIVATE',
        channel_type: 'channel',
        user: 'U_UNLINKED',
        text: '',
        ts: '1700000001.000150',
        files: [
          {
            id: 'F_PRIVATE',
            name: 'private-plan.pdf',
            mimetype: 'application/pdf',
            size: 8,
            url_private_download: 'https://files.example/private-plan.pdf',
          },
        ],
      }),
    );

    const rows = await pg.query<{
      owner_user_id: string | null;
      visibility: string;
      raw_visibility_owner_user_id: string | null;
    }>(
      `SELECT
         d.owner_user_id,
         d.visibility,
         r.visibility_owner_user_id AS raw_visibility_owner_user_id
       FROM documents d
       JOIN raw_events r ON r.id = d.source_raw_event_id
       WHERE d.name = 'private-plan.pdf'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      owner_user_id: USER_A,
      visibility: 'private',
      raw_visibility_owner_user_id: USER_A,
    });
  });

  it('captures Slack file captions as text work while routing the file to extraction', async () => {
    await seedBoundSlackUser(db);
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueDocumentExtract = vi.fn().mockResolvedValue(undefined);
    const queues = textQueueDeps();

    await handleSlackEnvelope(
      {
        db: db as never,
        ...queues,
        documents: { upload, enqueueExtract: enqueueDocumentExtract },
      },
      slackEnvelope('EvFileCaption', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'Please review this proposal by Friday',
        ts: '1700000001.000200',
        files: [
          {
            id: 'F_CAPTION',
            name: 'caption-plan.pdf',
            mimetype: 'application/pdf',
            size: 8,
            url_private_download: 'https://files.example/caption-plan.pdf',
          },
        ],
      }),
    );

    const slackRows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(slackRows).toHaveLength(1);
    expect(slackRows[0]?.contentText).toBe('Please review this proposal by Friday');
    expect(upload).toHaveBeenCalledOnce();
    expect(enqueueDocumentExtract).toHaveBeenCalledOnce();
    expect(queues.extract.enqueueExtract).toHaveBeenCalledWith({
      rawEventId: slackRows[0]?.id,
      teamId: TEAM_A,
    });
    expect(queues.embed.enqueueEmbed).toHaveBeenCalledWith({
      rawEventId: slackRows[0]?.id,
      teamId: TEAM_A,
    });
    expect(queues.suggestions.enqueueSuggestion).toHaveBeenCalledWith({
      rawEventId: slackRows[0]?.id,
      teamId: TEAM_A,
    });
  });

  it('stores Slack audio attachments with full replay source refs', async () => {
    await seedBoundSlackUser(db);
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueTranscribe = vi.fn().mockResolvedValue(undefined);

    await handleSlackEnvelope(
      {
        db: db as never,
        audio: {
          upload,
          enqueueTranscribe,
          buildAudioKey: ({ teamId, conversationId, messageTs, fileId, extension }) =>
            `teams/${teamId}/slack/${conversationId}/${messageTs}-${fileId}.${extension}`,
        },
      },
      slackEnvelope('EvAudioFile', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'Audio note from Slack',
        ts: '1700000002.000300',
        files: [
          {
            id: 'F_AUDIO',
            name: 'standup-note.mp3',
            mimetype: 'audio/mpeg',
            size: 12,
            url_private_download: 'https://files.example/standup-note.mp3',
          },
        ],
      }),
    );

    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'audio/mpeg' }));
    expect(enqueueTranscribe).toHaveBeenCalledOnce();
    const slackRows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(slackRows).toHaveLength(2);
    const child = slackRows.find((row) => row.contentAudioUrl);
    expect(child?.contentAudioUrl).toContain('F_AUDIO.mp3');
    const metadata = child?.sourceMetadata as Record<string, unknown> | undefined;
    expect(metadata).toMatchObject({
      slack_attachment_kind: 'audio',
      slack_file_id: 'F_AUDIO',
      slack_file_name: 'standup-note.mp3',
      slack_channel_id: 'C_DOCS',
      slack_message_ts: '1700000002.000300',
      source_payload_ref: `inline://timeline/slack/${WORKSPACE_ID}/C_DOCS/1700000002.000300/attachment/F_AUDIO`,
      source_snapshot_kind: 'slack_audio_attachment',
      source_snapshot_version: 'slack-source-snapshot-2026-07',
    });
    expect(metadata?.payload_digest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(metadata?.source_snapshot).toMatchObject({
      provider: 'slack',
      capture_kind: 'audio_attachment',
      file: { id: 'F_AUDIO', name: 'standup-note.mp3', mimetype: 'audio/mpeg' },
    });
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        eq(reconciliationEvidence.rawEventId, child?.id ?? '00000000-0000-0000-0000-000000000000'),
      );
    expect(evidence).toMatchObject({
      source: 'slack',
      provider: 'slack',
      replayState: 'full',
      sourcePayloadRef: `inline://timeline/slack/${WORKSPACE_ID}/C_DOCS/1700000002.000300/attachment/F_AUDIO`,
    });
    expect(evidence?.payloadDigest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
  });

  it('does not duplicate Slack attachments when a message with files is edited', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_A,
      slackConversationId: 'C_DOCS',
      conversationType: 'channel',
      title: 'docs',
      boundByUserId: USER_A,
      enabled: true,
    });
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const file = {
      id: 'F_EDIT',
      name: 'edited-plan.pdf',
      mimetype: 'application/pdf',
      size: 8,
      url_private_download: 'https://files.example/edited-plan.pdf',
    };

    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvOriginalFile', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'original',
        ts: '1700000003.000100',
        files: [file],
      }),
    );
    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvEditedFile', {
        type: 'message',
        subtype: 'message_changed',
        channel: 'C_DOCS',
        channel_type: 'channel',
        ts: '1700000010.000100',
        message: {
          user: 'U_SLACK',
          text: 'edited',
          ts: '1700000003.000100',
          files: [file],
        },
        previous_message: {
          user: 'U_SLACK',
          text: 'original',
          ts: '1700000003.000100',
        },
      }),
    );

    const docs = await pg.query<{ count: string }>('SELECT count(*)::text AS count FROM documents');
    expect(docs.rows[0]?.count).toBe('1');
    expect(upload).toHaveBeenCalledOnce();
    expect(enqueueExtract).toHaveBeenCalledOnce();
    const editRows = await pg.query<{
      occurred_at: Date;
      source_metadata: Record<string, unknown>;
    }>(
      `SELECT occurred_at, source_metadata
       FROM raw_events
       WHERE source_metadata->>'slack_event_id' = 'EvEditedFile'`,
    );
    expect(editRows.rows[0]?.occurred_at.toISOString()).toBe('2023-11-14T22:13:30.000Z');
    expect(editRows.rows[0]?.source_metadata).toMatchObject({
      slack_event_ts: '1700000010.000100',
    });
  });

  it('processes files newly added by a Slack message edit', async () => {
    await seedBoundSlackUser(db);
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const originalFile = {
      id: 'F_ORIGINAL',
      name: 'original-plan.pdf',
      mimetype: 'application/pdf',
      size: 8,
      url_private_download: 'https://files.example/original-plan.pdf',
    };
    const addedFile = {
      id: 'F_ADDED',
      name: 'added-plan.pdf',
      mimetype: 'application/pdf',
      size: 8,
      url_private_download: 'https://files.example/added-plan.pdf',
    };

    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvOriginalFiles', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'original',
        ts: '1700000004.000100',
        files: [originalFile],
      }),
    );
    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvEditedAddedFile', {
        type: 'message',
        subtype: 'message_changed',
        channel: 'C_DOCS',
        channel_type: 'channel',
        ts: '1700000011.000100',
        message: {
          user: 'U_SLACK',
          text: 'edited',
          ts: '1700000004.000100',
          files: [originalFile, addedFile],
        },
        previous_message: {
          user: 'U_SLACK',
          text: 'original',
          ts: '1700000004.000100',
        },
      }),
    );

    const docs = await pg.query<{ count: string }>('SELECT count(*)::text AS count FROM documents');
    expect(docs.rows[0]?.count).toBe('2');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(enqueueExtract).toHaveBeenCalledTimes(2);
  });

  it('posts a slash command failure follow-up when the agent throws', async () => {
    const fetchMock = installFetchMock();
    askAgentMock.mockRejectedValueOnce(new Error('model offline'));
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });

    await handleSlackSlashCommand(
      { db: db as never },
      {
        command: '/ask',
        text: 'what changed?',
        user_id: 'U_SLACK',
        team_id: 'T_SLACK',
        channel_id: 'C_DM',
        response_url: 'https://hooks.slack.test/response',
        trigger_id: 'trigger-failure',
      },
    );

    const responseCall = fetchMock.mock.calls.find(
      (call): call is [string, RequestInit] => call[0] === 'https://hooks.slack.test/response',
    );
    expect(responseCall?.[1].method).toBe('POST');
    const body = responseCall?.[1].body;
    expect(typeof body === 'string' ? body : '').toContain(
      'Timeline could not answer that right now.',
    );
  });

  it('answers /ask in a bound Slack channel from an unlinked Slack user', async () => {
    const fetchMock = installFetchMock();
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_A,
      slackConversationId: 'C_ASK',
      conversationType: 'channel',
      title: 'ask',
      boundByUserId: USER_A,
      enabled: true,
    });

    await handleSlackSlashCommand(
      { db: db as never },
      {
        command: '/ask',
        text: 'what changed?',
        user_id: 'U_UNLINKED',
        team_id: 'T_SLACK',
        channel_id: 'C_ASK',
        response_url: 'https://hooks.slack.test/response',
        trigger_id: 'trigger-unlinked-bound',
      },
    );

    expect(askAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_A,
        userId: '00000000-0000-0000-0000-000000000000',
        deliverySurface: 'slack',
        trustedTeamActor: true,
        toolMode: 'proposal_only',
        proposalOrigin: { surface: 'slack', actorKind: 'team_agent' },
        question: 'what changed?',
      }),
      expect.objectContaining({ includeMcpTools: true }),
    );
    expect(fetchBodyContaining(fetchMock, 'answer')).not.toBeNull();
  });

  it('shows every Slack command from /timeline help without requiring a user link', async () => {
    const fetchMock = installFetchMock();
    await seedWorkspace(db, TEAM_A);

    await handleSlackSlashCommand(
      { db: db as never },
      {
        command: '/timeline',
        text: 'help',
        user_id: 'U_UNLINKED',
        team_id: 'T_SLACK',
        channel_id: 'C_HELP',
        response_url: 'https://hooks.slack.test/response',
      },
    );

    const body = fetchBodyContaining(fetchMock, '/ask <question>');
    expect(body).not.toBeNull();
    expect(body).toContain('/timeline join <saved-meeting-alias-or-url> [optional title]');
    expect(body).toContain('/timeline help');
  });

  it('joins a Saved Meeting alias immediately from /timeline join', async () => {
    const fetchMock = installFetchMock();
    await seedBoundSlackUser(db);
    const savedMeetingId = await seedSavedMeeting(db);

    await handleSlackSlashCommand(
      { db: db as never },
      {
        command: '/timeline',
        text: 'join daily',
        user_id: 'U_SLACK',
        team_id: 'T_SLACK',
        channel_id: 'C_DOCS',
        response_url: 'https://hooks.slack.test/response',
      },
    );

    expect(responseBodies(fetchMock)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          response_type: 'in_channel',
          text: "Joining as Team A's thetimeline.cc bot.",
        }),
      ]),
    );
    const row = (
      await db.select().from(meetings).where(eq(meetings.savedMeetingId, savedMeetingId))
    )[0];
    expect(row).toMatchObject({
      status: 'joining',
      providerBotId: 'bot-slack-1',
      title: 'Internal daily meeting',
      meetingUrl: 'https://meet.google.com/slack-saved-test',
    });
    const recallCall = (fetchMock.mock.calls as [unknown, RequestInit | undefined][]).find(
      ([url]) => String(url).includes('recall.test/api/v1/bot'),
    );
    const recallBody =
      typeof recallCall?.[1]?.body === 'string'
        ? (JSON.parse(recallCall[1].body) as Record<string, unknown>)
        : {};
    expect(recallBody).toMatchObject({
      bot_name: "Team A's thetimeline.cc bot",
      meeting_url: 'https://meet.google.com/slack-saved-test',
    });
  });

  it('creates a button confirmation for raw URL /timeline joins instead of starting a bot', async () => {
    const fetchMock = installFetchMock();
    await seedBoundSlackUser(db);

    await handleSlackSlashCommand(
      { db: db as never },
      {
        command: '/timeline',
        text: 'join https://meet.google.com/raw-url-slack Design review',
        user_id: 'U_SLACK',
        team_id: 'T_SLACK',
        channel_id: 'C_DOCS',
        response_url: 'https://hooks.slack.test/response',
      },
    );

    const confirmations = await db.select().from(meetingCaptureConfirmations);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({
      status: 'pending',
      meetingUrl: 'https://meet.google.com/raw-url-slack',
      title: 'Design review',
      source: 'slack',
    });
    expect(responseBodies(fetchMock)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          response_type: 'ephemeral',
          text: 'Confirm participants know this call will be transcribed.',
        }),
      ]),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('recall.test'))).toBe(false);
    expect(await db.select().from(meetings)).toHaveLength(0);
  });

  it('attributes bound channel messages to the sender linked in that Timeline team', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackWorkspaceTeams).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_B,
      installedByUserId: USER_B,
      enabled: true,
    });
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_B,
      slackConversationId: 'C_TEAM_B',
      conversationType: 'channel',
      title: 'team-b',
      boundByUserId: USER_B,
      enabled: true,
    });
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Slack Sender',
    });
    await db.insert(slackUserTeams).values([
      {
        slackUserId: SLACK_USER_ROW_ID,
        teamId: TEAM_A,
        userId: USER_A,
        linkedByUserId: USER_A,
        isActive: true,
      },
      {
        slackUserId: SLACK_USER_ROW_ID,
        teamId: TEAM_B,
        userId: USER_B,
        linkedByUserId: USER_B,
        isActive: false,
      },
    ]);

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvChannel', {
        type: 'message',
        channel: 'C_TEAM_B',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'team b update',
        ts: '1700000002.000100',
      }),
    );

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: TEAM_B, authorUserId: USER_B });
  });

  it('keeps cached Slack profile data when users.info fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (href.includes('users.info')) {
          return Promise.resolve(Response.json({ ok: false, error: 'ratelimited' }));
        }
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
    await seedBoundSlackUser(db, 'C_PROFILE');
    await db
      .update(slackUsers)
      .set({
        name: 'cached-name',
        realName: 'Cached Real',
        email: 'cached@example.com',
        avatarUrl: 'https://cdn.example/avatar.png',
        metadata: { cached: true },
      })
      .where(eq(slackUsers.id, SLACK_USER_ROW_ID));

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvProfileCache', {
        type: 'message',
        channel: 'C_PROFILE',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'cached profile survives',
        ts: '1700000004.000100',
      }),
    );

    const users = await db
      .select({
        name: slackUsers.name,
        realName: slackUsers.realName,
        email: slackUsers.email,
        avatarUrl: slackUsers.avatarUrl,
        metadata: slackUsers.metadata,
      })
      .from(slackUsers)
      .where(eq(slackUsers.id, SLACK_USER_ROW_ID));
    expect(users[0]).toMatchObject({
      name: 'cached-name',
      realName: 'Cached Real',
      email: 'cached@example.com',
      avatarUrl: 'https://cdn.example/avatar.png',
      metadata: { cached: true },
    });

    const rows = await db
      .select({ metadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.source, 'slack'));
    expect(rows[0]?.metadata).toMatchObject({ slack_sender_name: 'Cached Real' });
  });
});
