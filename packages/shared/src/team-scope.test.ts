import { PGlite } from '@electric-sql/pglite';
import {
  auditLog,
  artifactClusters,
  artifactEvidenceAssociations,
  calendarEvents,
  connectionAttention,
  documents,
  documentVersions,
  entities,
  integrations,
  integrationSelections,
  integrationSyncState,
  meetingTranscriptChunks,
  meetings,
  notifications,
  objectChanges,
  objectIdentityFacets,
  objectNotes,
  providerConnections,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  teamProviderResourceShares,
  teamVisibilityDefaults,
  telegramChatBindings,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit, SearchOpts } from '#src/qdrant/client.js';

import { resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import {
  adminDecryptIntegrationTokens,
  adminRecordTransientSyncFailure,
  adminResetTransientSyncFailures,
} from '#src/integrations/scope.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_A}', 'team-a', 'Team A'), ('${TEAM_B}', 'team-b', 'Team B');
    INSERT INTO users (id, email)
    VALUES
      ('${USER_A}', 'a@example.com'),
      ('${USER_B}', 'b@example.com'),
      ('${USER_C}', 'c@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${USER_A}', 'owner'),
      ('${TEAM_A}', '${USER_B}', 'member'),
      ('${TEAM_A}', '${USER_C}', 'admin'),
      ('${TEAM_B}', '${USER_A}', 'owner');
  `);
}

async function insertTelegramEvent(
  pg: PGlite,
  input: {
    id: string;
    authorUserId: string | null;
    text: string;
    deleted?: boolean;
    username?: string;
    tgUserId?: number;
  },
): Promise<void> {
  const metadata = {
    tg_chat_id: 42,
    tg_chat_type: 'private',
    tg_message_id: 10,
    tg_update_id: Number(input.id.slice(-6)),
    ...(input.deleted ? { deleted: true } : {}),
    ...(input.username ? { tg_username: input.username } : {}),
    ...(input.tgUserId ? { tg_user_id: input.tgUserId } : {}),
  };
  await pg.query(
    `INSERT INTO raw_events (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, source_metadata)
     VALUES ($1, $2, $3, $3, 'telegram', $4, now(), $5::jsonb)`,
    [input.id, TEAM_A, input.authorUserId, input.text, JSON.stringify(metadata)],
  );
}

function qdrantRawEventHit(input: {
  id: string;
  score?: number;
  source?: 'telegram' | 'slack' | 'email';
}): SearchHit {
  return {
    id: `point-${input.id}`,
    score: input.score ?? 0.9,
    payload: {
      team_id: TEAM_A,
      source_kind: 'raw_event',
      event_id: input.id,
      fact_id: null,
      object_id: null,
      note_id: null,
      change_id: null,
      entity_id: null,
      entity_ids: [],
      occurred_at: '2026-06-01T10:00:00.000Z',
      author_user_id: null,
      visibility_owner_user_id: null,
      source: input.source ?? 'telegram',
      visibility: 'team',
      visibility_user_ids: null,
      embedding_model: 'test',
      source_scope: 'event',
      source_id: input.id,
      chunk_index: 0,
      document_id: null,
      document_version_id: null,
      document_chunk_id: null,
      folder_id: null,
      owner_user_id: null,
      updated_at: null,
      meeting_id: null,
      meeting_chunk_id: null,
      speaker: null,
    },
  };
}

describe('withTeam namespaced port', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    process.env.SECRETS_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  async function withHistoricalLegacyObjectProvenance<T>(run: () => Promise<T>): Promise<T> {
    await pg.exec(`
      ALTER TABLE entities DISABLE TRIGGER entities_legacy_provenance_write_guard;
      ALTER TABLE object_changes DROP CONSTRAINT object_changes_legacy_source_event_id_null_chk;
    `);
    try {
      return await run();
    } finally {
      await pg.exec(`
        ALTER TABLE entities ENABLE TRIGGER entities_legacy_provenance_write_guard;
        ALTER TABLE object_changes ADD CONSTRAINT object_changes_legacy_source_event_id_null_chk CHECK (source_event_id IS NULL) NOT VALID;
      `);
    }
  }

  it('exposes timeline and documents through modules, not flat methods', () => {
    const scope = withTeam(db as never, TEAM_A, USER_A) as unknown as Record<string, unknown>;

    expect(scope.timeline).toBeDefined();
    expect(scope.documents).toBeDefined();
    expect(scope.objects).toBeDefined();
    expect(scope.calendar).toBeDefined();
    expect(scope.integrations).toBeDefined();
    expect(scope.mcp).toBeDefined();

    expect(scope).not.toHaveProperty('listEvents');
    expect(scope).not.toHaveProperty('getEventWithFacts');
    expect(scope).not.toHaveProperty('searchEvents');
    expect(scope).not.toHaveProperty('getDocument');
    expect(scope).not.toHaveProperty('searchDocumentChunks');
  });

  it('binds object helpers to the scope team and keeps chat sessions private to the user', async () => {
    const scopeA = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);
    const otherTeamScope = withTeam(db as never, TEAM_B, USER_A);

    const object = await scopeA.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare board review',
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(scopeA.objects.getObject(object.id)).resolves.toMatchObject({
      id: object.id,
      canonicalName: 'Prepare board review',
    });
    await expect(otherTeamScope.objects.getObject(object.id)).resolves.toBeNull();
    await expect(otherTeamScope.objects.listObjects()).resolves.toEqual([]);

    const session = await scopeA.objects.createChatSession({ title: 'Private scratchpad' });

    await expect(scopeA.objects.listChatSessions()).resolves.toHaveLength(1);
    await expect(scopeA.objects.getChatSession(session.id)).resolves.toMatchObject({
      session: { id: session.id, title: 'Private scratchpad' },
    });
    await expect(teammateScope.objects.listChatSessions()).resolves.toEqual([]);
    await expect(teammateScope.objects.getChatSession(session.id)).resolves.toBeNull();
  });

  it('resolves visibility defaults by source, fallback, then hard team default', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'team',
      inherited: true,
    });

    await scope.timeline.setVisibilityDefault({
      source: 'team',
      visibility: 'private',
      sourceOwnerUserId: USER_A,
    });
    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'private',
      sourceOwnerUserId: USER_A,
      inherited: true,
    });

    await scope.timeline.setVisibilityDefault({ source: 'web', visibility: 'team' });
    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'team',
      inherited: false,
    });
  });

  it('coerces invalid inherited specific-users defaults to team visibility', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_A,
      source: 'team',
      visibility: 'specific_users',
      visibilityUserIds: [USER_A],
      sourceOwnerUserId: USER_A,
      updatedByUserId: USER_A,
    });

    await expect(scope.timeline.resolveVisibilityDefault('web')).resolves.toMatchObject({
      visibility: 'team',
      visibilityUserIds: null,
      sourceOwnerUserId: USER_A,
      inherited: true,
    });
  });

  it('rejects specific_users defaults on binary capture sources', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await expect(
      scope.timeline.setVisibilityDefault({
        source: 'telegram',
        visibility: 'specific_users',
        visibilityUserIds: [USER_A],
      }),
    ).rejects.toThrow('specific_users visibility is not supported');
  });

  it('rejects specific_users email events with an email-specific error', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await expect(
      scope.timeline.createEmailEvent({
        authorUserId: USER_A,
        visibility: 'specific_users',
        visibilityUserIds: [USER_A],
        messageId: 'specific-users-email@example.com',
        contentText: 'specific-users email',
        occurredAt: new Date('2026-05-27T09:00:00Z'),
      } as never),
    ).rejects.toThrow('specific_users visibility is not supported for email events');
  });

  it('threads email replies with scalar Message-IDs without malformed array literals', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const parent = await scope.timeline.createEmailEvent({
      authorUserId: USER_A,
      messageId: 'FRWP191MB3001FC5DB2A53F79176AA7D4981C2@FRWP191MB3001.EURP191.PROD.OUTLOOK.COM',
      contentText: 'parent email',
      occurredAt: new Date('2026-06-11T00:30:00Z'),
      sourceMetadata: {},
    });

    const child = await scope.timeline.createEmailEvent({
      authorUserId: USER_A,
      messageId: 'child-message@example.com',
      inReplyTo: 'FRWP191MB3001FC5DB2A53F79176AA7D4981C2@FRWP191MB3001.EURP191.PROD.OUTLOOK.COM',
      references: ['FRWP191MB3001FC5DB2A53F79176AA7D4981C2@FRWP191MB3001.EURP191.PROD.OUTLOOK.COM'],
      contentText: 'reply email',
      occurredAt: new Date('2026-06-11T00:32:00Z'),
      sourceMetadata: {},
    });

    expect(child?.threadRootId).toBe(parent?.id);
    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, child?.id ?? ''));
    expect(row?.sourceMetadata).toMatchObject({
      thread_root_id: parent?.id,
      in_reply_to: 'FRWP191MB3001FC5DB2A53F79176AA7D4981C2@FRWP191MB3001.EURP191.PROD.OUTLOOK.COM',
    });
  });

  it('stores contact metadata on threaded email raw events', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEmailEvent({
      authorUserId: USER_A,
      messageId: 'contact-email@example.com',
      contentText: [
        'Ada can be reached at ada@example.com.',
        'Phone: +1 213-373-4253',
        'Office address: 123 Market St, San Francisco, CA 94105',
      ].join('\n'),
      occurredAt: new Date('2026-06-20T09:00:00Z'),
      sourceMetadata: {},
    });
    if (!event) throw new Error('expected email event');

    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, event.id));
    expect(row?.sourceMetadata).toMatchObject({
      contacts: {
        emails: [expect.objectContaining({ normalized_value: 'ada@example.com' })],
        phones: [expect.objectContaining({ normalized_value: '+12133734253' })],
        addresses: [
          expect.objectContaining({
            normalized_value: '123 market st, san francisco, ca 94105',
            address_kind: 'postal_address',
          }),
        ],
      },
    });
  });

  it('creates link artifacts for generic timeline events', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'web',
      contentText:
        'Review https://example.com/specs/phase-14?utm_source=chat&ticket=42 and ping ada@example.com',
      visibility: 'team',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
    });

    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, event.id));
    const metadata = row?.sourceMetadata as Record<string, unknown>;
    const sourcePayloadRef = metadata.source_payload_ref;
    const payloadDigest = metadata.payload_digest;
    expect(typeof sourcePayloadRef).toBe('string');
    expect(typeof payloadDigest).toBe('string');
    if (typeof sourcePayloadRef !== 'string' || typeof payloadDigest !== 'string') {
      throw new Error('expected web replay metadata');
    }
    expect(sourcePayloadRef).toMatch(/^inline:\/\/timeline\/web\/[0-9a-f]{64}$/);
    expect(payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(row?.sourceMetadata).toMatchObject({
      source_snapshot_kind: 'web_text_capture',
      source_snapshot_version: 'web-text-source-snapshot-2026-07',
      source_snapshot: {
        provider: 'timeline_web',
        source: 'web',
        capture_kind: 'text_note',
        team_id: TEAM_A,
        author_user_id: USER_A,
        visibility_owner_user_id: USER_A,
        visibility: 'team',
        visibility_user_ids: null,
        occurred_at: '2026-06-20T10:00:00.000Z',
        content_text:
          'Review https://example.com/specs/phase-14?utm_source=chat&ticket=42 and ping ada@example.com',
      },
      links: [
        expect.objectContaining({
          canonical_url: 'https://example.com/specs/phase-14?ticket=42',
          display_url: 'example.com/specs/phase-14',
        }),
      ],
      contacts: {
        emails: [expect.objectContaining({ normalized_value: 'ada@example.com' })],
      },
    });
    const evidenceRows = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, event.id));
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({
      source: 'web',
      replayState: 'full',
      sourcePayloadRef,
      payloadDigest,
      visibility: 'team',
    });

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      teamId: TEAM_A,
      artifactType: 'link',
      canonicalName: 'example.com/specs/phase-14',
    });
    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toEqual([
      expect.objectContaining({
        rawEventId: event.id,
        role: 'related_context',
        strength: 'semantic',
        visibilityFloor: 'team',
      }),
    ]);
  });

  it('does not replace existing replay payload refs when creating web events', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'web',
      contentText: 'Imported web note with an existing replay payload.',
      visibility: 'team',
      occurredAt: new Date('2026-06-20T10:05:00Z'),
      sourceMetadata: {
        raw_payload_ref: '  s3://timeline-test/web/imported-note.json  ',
        payload_digest: 'sha256:imported-note',
      },
    });

    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, event.id));
    expect(row?.sourceMetadata).toMatchObject({
      raw_payload_ref: '  s3://timeline-test/web/imported-note.json  ',
      payload_digest: 'sha256:imported-note',
    });
    expect(row?.sourceMetadata).not.toHaveProperty('source_payload_ref');
    expect(row?.sourceMetadata).not.toHaveProperty('source_snapshot_kind');

    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, event.id));
    expect(evidence).toMatchObject({
      replayState: 'full',
      sourcePayloadRef: 's3://timeline-test/web/imported-note.json',
      payloadDigest: 'sha256:imported-note',
    });
  });

  it('repairs link artifacts when email delivery retries an existing raw event', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const first = await scope.timeline.createEmailEvent({
      authorUserId: USER_A,
      messageId: 'link-retry@example.com',
      contentText: 'Please review https://docs.example.com/runbook?step=1&utm_campaign=launch',
      occurredAt: new Date('2026-06-20T11:00:00Z'),
      sourceMetadata: {},
    });
    if (!first) throw new Error('expected initial email event');

    await db.delete(artifactClusters);
    await expect(db.select().from(artifactEvidenceAssociations)).resolves.toHaveLength(0);

    const retry = await scope.timeline.createEmailEvent({
      authorUserId: USER_A,
      messageId: 'link-retry@example.com',
      contentText: 'Please review https://docs.example.com/runbook?step=1&utm_campaign=launch',
      occurredAt: new Date('2026-06-20T11:00:00Z'),
      sourceMetadata: {},
    });

    expect(retry).toMatchObject({ id: first.id, deduplicated: true });
    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      artifactType: 'link',
      canonicalName: 'docs.example.com/runbook',
    });
    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toEqual([expect.objectContaining({ rawEventId: first.id })]);
  });

  it('materializes all visibility defaults from one settings fetch', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    await scope.timeline.setVisibilityDefault({
      source: 'team',
      visibility: 'private',
      sourceOwnerUserId: USER_A,
    });
    await scope.timeline.setVisibilityDefault({ source: 'document', visibility: 'team' });

    await expect(scope.timeline.getVisibilityDefaults()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'web',
          visibility: 'private',
          sourceOwnerUserId: USER_A,
          inherited: true,
        }),
        expect.objectContaining({
          source: 'document',
          visibility: 'team',
          inherited: false,
        }),
      ]),
    );
  });

  it('hides tombstoned raw events from timeline reads and hydration', async () => {
    const visibleId = '00000000-0000-0000-0000-000000000101';
    const deletedId = '00000000-0000-0000-0000-000000000102';
    await insertTelegramEvent(pg, {
      id: visibleId,
      authorUserId: USER_A,
      text: 'visible telegram',
    });
    await insertTelegramEvent(pg, {
      id: deletedId,
      authorUserId: USER_A,
      text: 'deleted telegram',
      deleted: true,
    });

    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(scope.timeline.listEvents({ source: 'telegram' })).resolves.toMatchObject([
      { id: visibleId },
    ]);
    await expect(scope.timeline.getEvent(deletedId)).resolves.toBeNull();
    await expect(scope.timeline.getEventsByIds([visibleId, deletedId])).resolves.toMatchObject([
      { id: visibleId },
    ]);
  });

  it('filters timeline events by provider resources and lists only visible source facets', async () => {
    const mondayId = '00000000-0000-0000-0000-000000000201';
    const githubId = '00000000-0000-0000-0000-000000000202';
    const slackId = '00000000-0000-0000-0000-000000000203';
    const telegramId = '00000000-0000-0000-0000-000000000204';
    const hiddenMondayId = '00000000-0000-0000-0000-000000000205';
    await pg.query(
      `INSERT INTO raw_events
        (id, team_id, author_user_id, visibility_owner_user_id, visibility, source, content_text, occurred_at, source_metadata)
       VALUES
        ($1, $2, $3, $3, 'team', 'integration', 'Monday launch update', now(), $4::jsonb),
        ($5, $2, $3, $3, 'team', 'integration', 'GitHub app update', now(), $6::jsonb),
        ($7, $2, $3, $3, 'team', 'slack', 'Slack design update', now(), $8::jsonb),
        ($9, $2, $3, $3, 'team', 'telegram', 'Telegram ops update', now(), $10::jsonb),
        ($11, $2, $12, $12, 'private', 'integration', 'Hidden Monday update', now(), $13::jsonb)`,
      [
        mondayId,
        TEAM_A,
        USER_A,
        JSON.stringify({
          provider: 'monday',
          monday_board_id: 'board-1',
          monday_board_name: 'Launch plan',
        }),
        githubId,
        JSON.stringify({ provider: 'github', github: { repo: 'acme/app' } }),
        slackId,
        JSON.stringify({
          slack_workspace_id: 'T123',
          slack_channel_id: 'C456',
          slack_channel_name: 'design',
        }),
        telegramId,
        JSON.stringify({ tg_chat_id: '-1001', tg_chat_title: 'Operations' }),
        hiddenMondayId,
        USER_B,
        JSON.stringify({
          provider: 'monday',
          monday_board_id: 'secret-board',
          monday_board_name: 'Secret board',
        }),
      ],
    );

    const scope = withTeam(db as never, TEAM_A, USER_A);
    await expect(
      scope.timeline.listEvents({
        origins: [{ kind: 'monday_board', boardId: 'board-1' }],
      }),
    ).resolves.toMatchObject([{ id: mondayId }]);
    await expect(
      scope.timeline.listEvents({
        origins: [
          { kind: 'github_repo', repo: 'acme/app' },
          { kind: 'telegram_chat', chatId: '-1001' },
        ],
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: githubId }),
        expect.objectContaining({ id: telegramId }),
      ]),
    );

    const facets = await scope.timeline.listSourceFacets();
    expect(facets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filter: { kind: 'monday_board', boardId: 'board-1' },
          label: 'Launch plan',
        }),
        expect.objectContaining({
          filter: { kind: 'github_repo', repo: 'acme/app' },
          label: 'acme/app',
        }),
        expect.objectContaining({
          filter: { kind: 'slack_channel', workspaceId: 'T123', channelId: 'C456' },
          label: '#design',
        }),
        expect.objectContaining({
          filter: { kind: 'telegram_chat', chatId: '-1001' },
          label: 'Operations',
        }),
      ]),
    );
    expect(facets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filter: { kind: 'monday_board', boardId: 'secret-board' } }),
      ]),
    );
  });

  it('lists every visible configured integration resource without requiring event-history groups', async () => {
    const visibleIntegrationId = '00000000-0000-4000-8000-000000000301';
    const privateIntegrationId = '00000000-0000-4000-8000-000000000302';
    const visibleGithubId = '00000000-0000-4000-8000-000000000303';
    const privateGithubId = '00000000-0000-4000-8000-000000000304';
    await db.insert(integrations).values([
      {
        id: visibleIntegrationId,
        teamId: TEAM_A,
        connectedByUserId: USER_A,
        provider: 'monday',
        displayName: 'Visible Monday',
        externalAccountId: 'visible-monday',
        visibilityDefault: 'team',
      },
      {
        id: privateIntegrationId,
        teamId: TEAM_A,
        connectedByUserId: USER_B,
        provider: 'monday',
        displayName: 'Private Monday',
        externalAccountId: 'private-monday',
        visibilityDefault: 'private',
      },
      {
        id: visibleGithubId,
        teamId: TEAM_A,
        connectedByUserId: USER_A,
        provider: 'github',
        displayName: 'Visible GitHub',
        externalAccountId: 'visible-github',
        visibilityDefault: 'team',
      },
      {
        id: privateGithubId,
        teamId: TEAM_A,
        connectedByUserId: USER_B,
        provider: 'github',
        displayName: 'Private GitHub',
        externalAccountId: 'private-github',
        visibilityDefault: 'private',
      },
    ]);
    await db.insert(integrationSelections).values([
      ...Array.from({ length: 501 }, (_, index) => ({
        integrationId: visibleIntegrationId,
        selectionKind: 'monday.board',
        externalId: `board-${String(index).padStart(3, '0')}`,
        externalLabel: `Board ${String(index).padStart(3, '0')}`,
      })),
      {
        integrationId: privateIntegrationId,
        selectionKind: 'monday.board',
        externalId: 'secret-board',
        externalLabel: 'Secret board',
      },
      {
        integrationId: visibleGithubId,
        selectionKind: 'github.org',
        externalId: 'acme',
        externalLabel: 'Acme',
      },
      {
        integrationId: privateGithubId,
        selectionKind: 'github.org',
        externalId: 'secret',
        externalLabel: 'Secret',
      },
    ]);
    await db.insert(integrationSyncState).values([
      {
        integrationId: visibleGithubId,
        resourceType: 'github.org:acme:repos',
        cursor: { repos: ['acme/app', 'acme/api'], fetched_at: new Date().toISOString() },
      },
      {
        integrationId: privateGithubId,
        resourceType: 'github.org:secret:repos',
        cursor: { repos: ['secret/repo'], fetched_at: new Date().toISOString() },
      },
    ]);
    await db.insert(telegramChatBindings).values([
      {
        tgChatId: -100500,
        teamId: TEAM_A,
        boundByUserId: USER_A,
        title: 'Durable team chat',
      },
      {
        tgChatId: -100600,
        teamId: TEAM_B,
        boundByUserId: USER_A,
        title: 'Other team chat',
      },
    ]);

    const facets = await withTeam(db as never, TEAM_A, USER_A).timeline.listSourceFacets();
    expect(facets.filter((facet) => facet.filter.kind === 'monday_board')).toHaveLength(501);
    expect(facets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filter: { kind: 'provider', provider: 'monday' },
        }),
        expect.objectContaining({
          filter: { kind: 'monday_board', boardId: 'board-500' },
          label: 'Board 500',
        }),
        expect.objectContaining({
          filter: { kind: 'github_repo', repo: 'acme/api' },
          label: 'acme/api',
        }),
        expect.objectContaining({
          filter: { kind: 'telegram_chat', chatId: '-100500' },
          label: 'Durable team chat',
        }),
      ]),
    );
    expect(facets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filter: { kind: 'monday_board', boardId: 'secret-board' } }),
        expect.objectContaining({ filter: { kind: 'github_repo', repo: 'secret/repo' } }),
        expect.objectContaining({ filter: { kind: 'telegram_chat', chatId: '-100600' } }),
      ]),
    );
  });

  it('uses the newest event label when a source resource has been renamed', async () => {
    await pg.query(
      `INSERT INTO raw_events
        (id, team_id, author_user_id, visibility_owner_user_id, visibility, source, content_text, occurred_at, source_metadata)
       VALUES
        ('00000000-0000-0000-0000-000000000311', $1, $2, $2, 'team', 'integration', 'Old board update', '2026-07-01T10:00:00Z', $3::jsonb),
        ('00000000-0000-0000-0000-000000000312', $1, $2, $2, 'team', 'integration', 'New board update', '2026-07-02T10:00:00Z', $4::jsonb)`,
      [
        TEAM_A,
        USER_A,
        JSON.stringify({
          provider: 'monday',
          monday_board_id: 'renamed-board',
          monday_board_name: 'Old name',
        }),
        JSON.stringify({
          provider: 'monday',
          monday_board_id: 'renamed-board',
          monday_board_name: 'Current name',
        }),
      ],
    );

    const facets = await withTeam(db as never, TEAM_A, USER_A).timeline.listSourceFacets();
    expect(facets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filter: { kind: 'monday_board', boardId: 'renamed-board' },
          label: 'Current name',
          eventCount: 2,
        }),
      ]),
    );
  });

  it('fails closed for person sender filters when no approved identity facet exists', async () => {
    const eventId = '00000000-0000-0000-0000-000000000106';
    await insertTelegramEvent(pg, {
      id: eventId,
      authorUserId: null,
      text: 'visible telegram from someone else',
      username: 'someone',
      tgUserId: 123,
    });
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Mikael Rintala',
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(scope.timeline.listEvents({ personObjectId: person.id })).resolves.toEqual([]);
  });

  it('matches telegram senderHandle when raw username includes at-prefix', async () => {
    const eventId = '00000000-0000-0000-0000-000000000107';
    await insertTelegramEvent(pg, {
      id: eventId,
      authorUserId: null,
      text: 'telegram from prefixed username',
      username: '@mikaelrintala',
      tgUserId: 12345,
    });
    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(
      scope.timeline.listEvents({ source: 'telegram', senderHandle: '@mikaelrintala' }),
    ).resolves.toMatchObject([{ id: eventId }]);
    await expect(
      scope.timeline.listEvents({ source: 'telegram', senderHandle: 'mikaelrintala' }),
    ).resolves.toMatchObject([{ id: eventId }]);
  });

  it('matches telegram person sender filters when raw username includes at-prefix', async () => {
    const eventId = '00000000-0000-0000-0000-000000000108';
    await insertTelegramEvent(pg, {
      id: eventId,
      authorUserId: null,
      text: 'telegram from linked person',
      username: '@mikaelrintala',
      tgUserId: 12345,
    });
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Mikael Rintala',
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.objects.createIdentityFacet({
      entityId: person.id,
      kind: 'telegram',
      value: '@mikaelrintala',
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(
      scope.timeline.listEvents({ source: 'telegram', personObjectId: person.id }),
    ).resolves.toMatchObject([{ id: eventId }]);
  });

  it('matches email sender filters across nested and flat metadata shapes', async () => {
    const fromEmailId = '00000000-0000-0000-0000-000000000120';
    const senderEmailId = '00000000-0000-0000-0000-000000000121';
    await pg.query(
      `INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, occurred_at, source_metadata)
       VALUES
         ($1, $2, NULL, 'email', 'flat from_email event', now(), $3::jsonb),
         ($4, $2, NULL, 'email', 'flat sender_email event', now(), $5::jsonb)`,
      [
        fromEmailId,
        TEAM_A,
        JSON.stringify({ from_email: 'Mikael@Example.com' }),
        senderEmailId,
        JSON.stringify({ sender_email: 'mikael@example.com' }),
      ],
    );
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Mikael Rintala',
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.objects.createIdentityFacet({
      entityId: person.id,
      kind: 'email',
      value: 'mikael@example.com',
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(
      scope.timeline.listEvents({ senderSource: 'email', senderHandle: 'mikael@example.com' }),
    ).resolves.toMatchObject([{ id: senderEmailId }, { id: fromEmailId }]);
    await expect(
      scope.timeline.listEvents({ senderSource: 'email', personObjectId: person.id }),
    ).resolves.toMatchObject([{ id: senderEmailId }, { id: fromEmailId }]);
  });

  it('limits listEvents by senderSource even without handle or person filters', async () => {
    const telegramId = '00000000-0000-0000-0000-000000000109';
    const emailId = '00000000-0000-0000-0000-000000000110';
    await insertTelegramEvent(pg, {
      id: telegramId,
      authorUserId: null,
      text: 'telegram sender source event',
      username: '@mikaelrintala',
    });
    await pg.query(
      `INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, occurred_at, source_metadata)
       VALUES ($1, $2, NULL, 'email', 'email sender source event', now(), $3::jsonb)`,
      [emailId, TEAM_A, JSON.stringify({ from: { email: 'mikael@example.com' } })],
    );
    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(scope.timeline.listEvents({ senderSource: 'telegram' })).resolves.toMatchObject([
      { id: telegramId },
    ]);
    await expect(scope.timeline.listEvents({ senderSource: 'email' })).resolves.toMatchObject([
      { id: emailId },
    ]);
  });

  it('passes SQL sender-filtered event ids into semantic search', async () => {
    const matchingId = '00000000-0000-0000-0000-000000000111';
    const otherId = '00000000-0000-0000-0000-000000000112';
    await insertTelegramEvent(pg, {
      id: matchingId,
      authorUserId: null,
      text: 'matching sender search event',
      username: '@mikaelrintala',
    });
    await insertTelegramEvent(pg, {
      id: otherId,
      authorUserId: null,
      text: 'other sender search event',
      username: '@someoneelse',
    });
    const qdrantSearch = vi.fn().mockResolvedValue([
      {
        id: 'point-1',
        score: 0.9,
        payload: {
          team_id: TEAM_A,
          source_kind: 'raw_event',
          event_id: matchingId,
          fact_id: null,
          object_id: null,
          note_id: null,
          change_id: null,
          entity_id: null,
          entity_ids: [],
          occurred_at: '2026-06-01T10:00:00.000Z',
          author_user_id: null,
          visibility_owner_user_id: null,
          source: 'telegram',
          visibility: 'team',
          visibility_user_ids: null,
          embedding_model: 'test',
          document_id: null,
          document_version_id: null,
          document_chunk_id: null,
          folder_id: null,
          owner_user_id: null,
          updated_at: null,
          meeting_id: null,
          meeting_chunk_id: null,
          speaker: null,
        },
      },
    ]);
    const scope = withTeam(db as never, TEAM_A, USER_A, {
      embed: () => Promise.resolve({ vector: [0.1], model: 'test' }),
      qdrantSearch,
    });

    await expect(
      scope.timeline.searchEvents({
        query: 'sender search',
        senderHandle: '@mikaelrintala',
      }),
    ).resolves.toHaveLength(1);

    expect(qdrantSearch).toHaveBeenCalledWith(
      TEAM_A,
      USER_A,
      [0.1],
      expect.objectContaining({ eventIds: [matchingId] }),
    );
  });

  it('retrieves accepted object-note Q&A with owning object and suggestion evidence', async () => {
    const writeScope = withTeam(db as never, TEAM_A, USER_A);
    const event = await writeScope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'telegram',
      contentText: 'Q: Where do refunds go? A: Send them to finance-ops.',
      visibility: 'team',
    });
    const object = await writeScope.objects.createObject({
      type: 'topic',
      canonicalName: 'Support routing',
      actor: { kind: 'user', userId: USER_A },
    });
    const bundle = await writeScope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember refund routing answer',
      dedupeKey: 'qna-note-search',
      evidence: [{ rawEventId: event.id, quote: 'Send them to finance-ops.' }],
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: object.id,
          title: 'Add refund routing Q&A',
          dedupeKey: 'qna-note-search:item',
          proposedPayload: {
            entityId: object.id,
            body: 'Q: Where do refunds go?\nA: Send them to finance-ops.',
          },
        },
      ],
    });
    await expect(
      writeScope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);
    const [note] = await db
      .select({ id: objectNotes.id })
      .from(objectNotes)
      .where(eq(objectNotes.entityId, object.id))
      .limit(1);
    expect(note?.id).toBeDefined();

    const qdrantSearch = vi.fn().mockResolvedValue([
      {
        id: `object-note-${note?.id}`,
        score: 0.93,
        payload: {
          ...qdrantRawEventHit({ id: event.id }).payload,
          source_kind: 'object_note',
          event_id: null,
          object_id: object.id,
          note_id: note?.id ?? null,
          source: 'system',
          source_scope: 'object_note',
          source_id: note?.id ?? '',
        },
      },
    ]);
    const readScope = withTeam(db as never, TEAM_A, USER_A, {
      embed: () => Promise.resolve({ vector: [0.4], model: 'test' }),
      qdrantSearch,
    });

    await expect(
      readScope.timeline.searchObjectNotes({ query: 'refund routing' }),
    ).resolves.toEqual([
      expect.objectContaining({
        noteId: note?.id,
        objectId: object.id,
        objectName: 'Support routing',
        objectType: 'topic',
        body: 'Q: Where do refunds go?\nA: Send them to finance-ops.',
        evidence: [{ rawEventId: event.id, quote: 'Send them to finance-ops.' }],
      }),
    ]);
    expect(qdrantSearch).toHaveBeenCalledWith(
      TEAM_A,
      USER_A,
      [0.4],
      expect.objectContaining({ sourceKind: 'object_note' }),
    );
  });

  it('searches every SQL sender-filtered event id batch before ranking semantic results', async () => {
    const firstId = '00000000-0000-0000-0000-000000000122';
    const secondId = '00000000-0000-0000-0000-000000000123';
    const thirdId = '00000000-0000-0000-0000-000000000124';
    for (const id of [firstId, secondId, thirdId]) {
      await insertTelegramEvent(pg, {
        id,
        authorUserId: null,
        text: `batched sender search ${id}`,
        username: '@mikaelrintala',
      });
    }
    const qdrantSearch = vi.fn(
      (
        _teamId: string,
        _userId: string,
        _vector: number[],
        opts: SearchOpts,
      ): Promise<SearchHit[]> => {
        if (opts.eventIds?.includes(firstId))
          return Promise.resolve([qdrantRawEventHit({ id: firstId, score: 0.4 })]);
        if (opts.eventIds?.includes(thirdId))
          return Promise.resolve([qdrantRawEventHit({ id: thirdId, score: 0.95 })]);
        return Promise.resolve([]);
      },
    );
    const scope = withTeam(db as never, TEAM_A, USER_A, {
      embed: () => Promise.resolve({ vector: [0.3], model: 'test' }),
      qdrantSearch,
      senderSearchEventIdBatchSize: 2,
    });

    await expect(
      scope.timeline.searchEvents({
        query: 'sender search all batches',
        senderHandle: '@mikaelrintala',
        limit: 1,
      }),
    ).resolves.toMatchObject([{ eventId: thirdId }]);

    expect(qdrantSearch).toHaveBeenCalledTimes(2);
    expect(qdrantSearch.mock.calls.map(([, , , opts]) => opts.eventIds)).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([thirdId, secondId]),
        expect.arrayContaining([firstId]),
      ]),
    );
    expect(qdrantSearch.mock.calls.map(([, , , opts]) => opts.limit)).toEqual([2, 2]);
  });

  it('uses qdrant source filtering instead of event-id prefilter for senderSource-only search', async () => {
    const eventId = '00000000-0000-0000-0000-000000000113';
    await insertTelegramEvent(pg, {
      id: eventId,
      authorUserId: null,
      text: 'telegram source-only search event',
      username: '@mikaelrintala',
    });
    const qdrantSearch = vi.fn().mockResolvedValue([
      {
        id: 'point-source-only',
        score: 0.9,
        payload: {
          team_id: TEAM_A,
          source_kind: 'raw_event',
          event_id: eventId,
          fact_id: null,
          object_id: null,
          note_id: null,
          change_id: null,
          entity_id: null,
          entity_ids: [],
          occurred_at: '2026-06-01T10:00:00.000Z',
          author_user_id: null,
          visibility_owner_user_id: null,
          source: 'telegram',
          visibility: 'team',
          visibility_user_ids: null,
          embedding_model: 'test',
          document_id: null,
          document_version_id: null,
          document_chunk_id: null,
          folder_id: null,
          owner_user_id: null,
          updated_at: null,
          meeting_id: null,
          meeting_chunk_id: null,
          speaker: null,
        },
      },
    ]);
    const scope = withTeam(db as never, TEAM_A, USER_A, {
      embed: () => Promise.resolve({ vector: [0.2], model: 'test' }),
      qdrantSearch,
    });

    await expect(
      scope.timeline.searchEvents({
        query: 'telegram source only',
        senderSource: 'telegram',
      }),
    ).resolves.toHaveLength(1);

    expect(qdrantSearch).toHaveBeenCalledWith(
      TEAM_A,
      USER_A,
      [0.2],
      expect.objectContaining({ source: 'telegram' }),
    );
    expect(qdrantSearch.mock.calls[0]?.[3]).not.toHaveProperty('eventIds');
  });

  it('includes meeting transcript chunks in timeline search and hydrates transcript snippets', async () => {
    const rawEventId = '00000000-0000-0000-0000-000000000114';
    const meetingId = '00000000-0000-0000-0000-000000000115';
    const meetingChunkId = '00000000-0000-0000-0000-000000000116';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_A,
      authorUserId: USER_A,
      visibilityOwnerUserId: USER_A,
      source: 'meeting',
      contentText: 'Meeting transcript summary fallback.',
      occurredAt: new Date('2026-06-02T14:00:00Z'),
      visibility: 'team',
      sourceMetadata: { meeting_id: meetingId },
    });
    await db.insert(meetings).values({
      id: meetingId,
      teamId: TEAM_A,
      createdByUserId: USER_A,
      platform: 'meet',
      meetingUrl: 'https://meet.example.test/northstar-renewal',
      title: 'Northstar renewal review',
      status: 'completed',
      defaultVisibility: 'team',
      startedAt: new Date('2026-06-02T14:00:00Z'),
      endedAt: new Date('2026-06-02T14:30:00Z'),
    });
    await db.insert(meetingTranscriptChunks).values({
      id: meetingChunkId,
      teamId: TEAM_A,
      meetingId,
      speaker: 'Maya',
      text: 'Northstar renewal follow-up: Sam owns the migration date approval before July 6.',
      startMs: 12_000,
      endMs: 18_000,
      rawEventId,
    });

    const qdrantSearch = vi.fn().mockResolvedValue([
      {
        id: `point-${meetingChunkId}`,
        score: 0.97,
        payload: {
          team_id: TEAM_A,
          source_kind: 'meeting_chunk',
          event_id: rawEventId,
          fact_id: null,
          object_id: null,
          note_id: null,
          change_id: null,
          entity_id: null,
          entity_ids: [],
          occurred_at: '2026-06-02T14:00:00.000Z',
          author_user_id: USER_A,
          visibility_owner_user_id: USER_A,
          source: 'meeting',
          visibility: 'team',
          visibility_user_ids: null,
          embedding_model: 'test',
          source_scope: 'meeting_chunk',
          source_id: meetingChunkId,
          chunk_index: 0,
          document_id: null,
          document_version_id: null,
          document_chunk_id: null,
          folder_id: null,
          owner_user_id: null,
          updated_at: null,
          meeting_id: meetingId,
          meeting_chunk_id: meetingChunkId,
          speaker: 'Maya',
        },
      } satisfies SearchHit,
    ]);
    const scope = withTeam(db as never, TEAM_A, USER_A, {
      embed: () => Promise.resolve({ vector: [0.4], model: 'test' }),
      qdrantSearch,
    });

    const results = await scope.timeline.searchEvents({
      query: 'Northstar renewal migration approval',
      limit: 3,
    });

    expect(qdrantSearch.mock.calls[0]?.[3]).toMatchObject({
      sourceKind: ['raw_event', 'fact', 'doc_chunk', 'meeting_chunk'],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      eventId: rawEventId,
      source: 'meeting',
      snippet:
        'Maya: Northstar renewal follow-up: Sam owns the migration date approval before July 6.',
    });
    expect(results[0]?.snippet).not.toContain('summary fallback');
  });

  it('does not hydrate entity facts whose source event has been tombstoned', async () => {
    const deletedId = '00000000-0000-0000-0000-000000000103';
    const entityId = '00000000-0000-0000-0000-000000000104';
    const factId = '00000000-0000-0000-0000-000000000105';
    await insertTelegramEvent(pg, {
      id: deletedId,
      authorUserId: USER_A,
      text: 'deleted source fact',
      deleted: true,
    });
    await pg.exec(`
      INSERT INTO entities (id, team_id, type, canonical_name)
      VALUES ('${entityId}', '${TEAM_A}', 'person', 'Alice Deleted');
      INSERT INTO facts (id, team_id, raw_event_id, statement, confidence, model_version)
      VALUES ('${factId}', '${TEAM_A}', '${deletedId}', 'Alice Deleted knows the old plan', 0.9, 'test-model');
      INSERT INTO fact_entities (fact_id, entity_id, role)
      VALUES ('${factId}', '${entityId}', 'subject');
    `);

    const profile = await withTeam(db as never, TEAM_A, USER_A).timeline.getEntity(entityId);

    expect(profile).not.toBeNull();
    expect(profile?.facts).toEqual([]);
    expect(profile?.events).toEqual([]);
  });

  it('allows a Telegram author to tombstone their own message revisions', async () => {
    const originalId = '00000000-0000-0000-0000-000000000201';
    const editId = '00000000-0000-0000-0000-000000000202';
    await insertTelegramEvent(pg, {
      id: originalId,
      authorUserId: USER_A,
      text: 'original',
    });
    await insertTelegramEvent(pg, {
      id: editId,
      authorUserId: USER_A,
      text: 'edit',
    });

    const scope = withTeam(db as never, TEAM_A, USER_A);
    await expect(scope.timeline.removeTelegramMessage(editId)).resolves.toBe(true);
    await expect(scope.timeline.listEvents({ source: 'telegram' })).resolves.toEqual([]);

    const rows = await pg.query<{ reason: string; count: string }>(
      `SELECT source_metadata->>'delete_reason' AS reason, count(*)::text AS count
       FROM raw_events
       WHERE source = 'telegram'
       GROUP BY source_metadata->>'delete_reason'`,
    );
    expect(rows.rows).toEqual([{ reason: 'telegram_removed_in_timeline', count: '2' }]);
  });

  it('allows admins but rejects non-author members and non-Telegram events', async () => {
    const telegramId = '00000000-0000-0000-0000-000000000301';
    await insertTelegramEvent(pg, {
      id: telegramId,
      authorUserId: USER_A,
      text: 'moderate me',
    });

    const memberScope = withTeam(db as never, TEAM_A, USER_B);
    await expect(memberScope.timeline.removeTelegramMessage(telegramId)).rejects.toThrow(
      'Only the message author or a team admin can remove this event',
    );

    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    await expect(adminScope.timeline.removeTelegramMessage(telegramId)).resolves.toBe(true);

    const web = await withTeam(db as never, TEAM_A, USER_A).timeline.createEvent({
      authorUserId: USER_A,
      source: 'web',
      contentText: 'not telegram',
    });
    await expect(adminScope.timeline.removeTelegramMessage(web.id)).rejects.toThrow(
      'Only Telegram and Slack events can be removed this way',
    );
  });

  it('only the visibility owner can change an existing event visibility and audits it', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    const event = await ownerScope.timeline.createEvent({
      authorUserId: USER_B,
      visibilityOwnerUserId: USER_A,
      source: 'web',
      contentText: 'owner controlled',
      visibility: 'team',
    });

    await expect(
      adminScope.timeline.setEventVisibility(event.id, { visibility: 'private' }),
    ).rejects.toThrow('Only the visibility owner');

    await ownerScope.timeline.setEventVisibility(event.id, {
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
    });
    await expect(ownerScope.timeline.getEvent(event.id)).resolves.toBeNull();
    await expect(
      withTeam(db as never, TEAM_A, USER_B).timeline.getEvent(event.id),
    ).resolves.toMatchObject({
      id: event.id,
    });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, event.id));
    expect(row?.visibility).toBe('specific_users');
    expect(row?.visibilityUserIds).toEqual([USER_B]);

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.targetId, event.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('visibility_change');
    expect(auditRows[0]?.metadata).toMatchObject({
      previous: { visibility: 'team' },
      next: { visibility: 'specific_users', visibilityUserIds: [USER_B] },
    });

    const defaults = await db.select().from(teamVisibilityDefaults);
    expect(defaults).toHaveLength(0);

    await ownerScope.timeline.setEventVisibility(event.id, { visibility: 'team' });
    await expect(ownerScope.timeline.getEvent(event.id)).resolves.toMatchObject({ id: event.id });
  });

  it('lets a private source-owned event be read and edited by its visibility owner', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    const event = await ownerScope.timeline.createEvent({
      authorUserId: null,
      visibilityOwnerUserId: USER_A,
      source: 'email',
      contentText: 'unverified sender private email',
      visibility: 'private',
    });

    await expect(ownerScope.timeline.getEvent(event.id)).resolves.toMatchObject({ id: event.id });
    await expect(teammateScope.timeline.getEvent(event.id)).resolves.toBeNull();
    await expect(adminScope.timeline.getEvent(event.id)).resolves.toBeNull();

    await ownerScope.timeline.setEventVisibility(event.id, { visibility: 'team' });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.id, event.id));
    expect(row?.visibility).toBe('team');
  });

  it('audits source-owned private event detail reads against the visibility owner', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const event = await ownerScope.timeline.createEvent({
      authorUserId: null,
      visibilityOwnerUserId: USER_A,
      source: 'email',
      contentText: 'source-owned audit event',
      visibility: 'private',
    });

    await expect(ownerScope.timeline.getEventWithFacts(event.id)).resolves.toMatchObject({
      event: { id: event.id },
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'event.detail_read',
      targetOwnerUserId: USER_A,
    });
  });

  it('does not leak private document impact through team-visible source events', async () => {
    const documentId = '00000000-0000-0000-0000-000000000502';
    const versionId = '00000000-0000-0000-0000-000000000503';
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);

    const event = await ownerScope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'document',
      contentText: 'Uploaded board-private planning notes',
      visibility: 'team',
    });

    await db.insert(documents).values({
      id: documentId,
      teamId: TEAM_A,
      name: 'Private planning notes.pdf',
      ownerUserId: USER_A,
      visibility: 'team',
    });
    await db.insert(documentVersions).values({
      id: versionId,
      teamId: TEAM_A,
      documentId,
      version: 1,
      objectKey: 'documents/private-planning-notes.pdf',
      byteSize: 1024,
      contentType: 'application/pdf',
      checksumSha256: 'test-checksum',
      uploadedByUserId: USER_A,
      sourceEventId: event.id,
      processingStatus: 'embedded',
    });

    await expect(teammateScope.timeline.listImpactItems([event.id])).resolves.toMatchObject({
      [event.id]: [
        expect.objectContaining({
          kind: 'document',
          label: 'Private planning notes.pdf',
        }),
      ],
    });

    await ownerScope.documents.setDocumentVisibility({
      id: documentId,
      visibility: 'private',
    });

    await expect(teammateScope.timeline.listImpactItems([event.id])).resolves.toEqual({});
    await expect(ownerScope.timeline.listImpactItems([event.id])).resolves.toMatchObject({
      [event.id]: [
        expect.objectContaining({
          kind: 'document',
          label: 'Private planning notes.pdf',
        }),
      ],
    });
  });

  it('does not leak private calendar impact through raw event ids', async () => {
    const calendarEventId = '00000000-0000-0000-0000-000000000601';
    const rawEventId = '00000000-0000-0000-0000-000000000602';

    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_A,
      authorUserId: USER_A,
      visibilityOwnerUserId: USER_A,
      source: 'calendar',
      contentText: 'Private acquisition planning',
      occurredAt: new Date('2026-06-01T10:00:00Z'),
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
      sourceMetadata: { calendar_event_id: calendarEventId, action: 'event' },
    });
    await db.insert(calendarEvents).values({
      id: calendarEventId,
      teamId: TEAM_A,
      createdByUserId: USER_A,
      title: 'Private acquisition planning',
      startAt: new Date('2026-06-01T10:00:00Z'),
      endAt: new Date('2026-06-01T11:00:00Z'),
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
      startAtRawEventId: rawEventId,
    });

    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const teammateScope = withTeam(db as never, TEAM_A, USER_B);

    await expect(teammateScope.timeline.listImpactItems([rawEventId])).resolves.toMatchObject({
      [rawEventId]: [
        expect.objectContaining({
          kind: 'calendar',
          label: 'Private acquisition planning',
        }),
      ],
    });

    await db
      .update(calendarEvents)
      .set({ visibility: 'private', visibilityUserIds: null })
      .where(eq(calendarEvents.id, calendarEventId));

    await expect(teammateScope.timeline.listImpactItems([rawEventId])).resolves.toEqual({});
    await expect(ownerScope.timeline.listImpactItems([rawEventId])).resolves.toMatchObject({
      [rawEventId]: [
        expect.objectContaining({
          kind: 'calendar',
          label: 'Private acquisition planning',
        }),
      ],
    });
  });

  it('hydrates direct object-write impact from reconciliation output source refs', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);

    const object = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Ship source-ref impact chips',
      actor: { kind: 'user', userId: USER_A },
    });

    const changes = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, object.id));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.sourceEventId).toBeNull();

    const [output] = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.targetId, object.id));
    const sourceRefs = output?.sourceRefs as { rawEventId?: unknown }[] | undefined;
    const rawEventId = sourceRefs?.find((ref) => typeof ref.rawEventId === 'string')?.rawEventId;
    if (typeof rawEventId !== 'string') throw new Error('expected direct-write source ref');

    await expect(scope.timeline.listImpactItems([rawEventId])).resolves.toMatchObject({
      [rawEventId]: [
        expect.objectContaining({
          kind: 'task',
          label: 'Ship source-ref impact chips',
          href: `/app/objects/${object.id}`,
          status: 'create',
        }),
      ],
    });
  });

  it('does not hydrate object impact from legacy source_event_id pointers', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const legacyEvent = await scope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'telegram',
      contentText: 'Legacy object provenance pointer without reconciliation output.',
      visibility: 'team',
    });
    const object = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Legacy Impact Co',
      actor: { kind: 'user', userId: USER_A },
    });

    await withHistoricalLegacyObjectProvenance(async () => {
      await db
        .update(entities)
        .set({ sourceEventId: legacyEvent.id })
        .where(eq(entities.id, object.id));
      await db.insert(objectChanges).values({
        teamId: TEAM_A,
        entityId: object.id,
        actorKind: 'agent',
        actorUserId: null,
        status: 'applied',
        field: 'stage',
        previousValue: null,
        newValue: 'pilot',
        sourceEventId: legacyEvent.id,
        note: 'Legacy pointer should not become timeline impact.',
      });
    });

    await expect(scope.timeline.listImpactItems([legacyEvent.id])).resolves.toEqual({});
  });

  it('links accepted object-memory suggestion impact to the object, not the created note', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'telegram',
      contentText: 'Miku handles customer follow-up.',
      visibility: 'team',
    });
    const object = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Customer follow-up',
      actor: { kind: 'user', userId: USER_A },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Remember project owner',
      dedupeKey: 'impact-object-note',
      evidence: [{ rawEventId: event.id }],
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: object.id,
          title: 'Add project memory',
          dedupeKey: 'impact-object-note:item',
          proposedPayload: {
            entityId: object.id,
            body: 'Miku handles customer follow-up.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    await expect(scope.timeline.listImpactItems([event.id])).resolves.toMatchObject({
      [event.id]: [
        expect.objectContaining({
          kind: 'object',
          label: 'Add project memory',
          href: `/app/objects/${object.id}`,
          status: 'accepted',
        }),
      ],
    });
  });

  it('links accepted relationship suggestion impact to the source object', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'telegram',
      contentText: 'Project Falcon is related to Acme.',
      visibility: 'team',
    });
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Project Falcon',
      actor: { kind: 'user', userId: USER_A },
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Acme',
      actor: { kind: 'user', userId: USER_A },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Remember project company relationship',
      dedupeKey: 'impact-object-relationship',
      evidence: [{ rawEventId: event.id }],
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          targetId: project.id,
          title: 'Add related relationship',
          dedupeKey: 'impact-object-relationship:item',
          proposedPayload: {
            fromEntityId: project.id,
            toEntityId: company.id,
            kind: 'related',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    await expect(scope.timeline.listImpactItems([event.id])).resolves.toMatchObject({
      [event.id]: [
        expect.objectContaining({
          kind: 'object',
          label: 'Add related relationship',
          href: `/app/objects/${project.id}`,
          status: 'accepted',
        }),
      ],
    });
  });

  it('links pending object merge suggestion impact to the merge preview', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'telegram',
      contentText: 'Acme and ACME Inc are the same company.',
      visibility: 'team',
    });
    const survivor = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Acme',
      actor: { kind: 'user', userId: USER_A },
    });
    const duplicate = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'ACME Inc',
      actor: { kind: 'user', userId: USER_A },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Review duplicate company objects',
      dedupeKey: 'impact-object-merge',
      evidence: [{ rawEventId: event.id }],
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: survivor.id,
          title: 'Review Acme merge',
          dedupeKey: 'impact-object-merge:item',
          proposedPayload: {
            objectIds: [survivor.id, duplicate.id],
            survivorId: survivor.id,
            reason: 'Names look equivalent.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    const impacts = await scope.timeline.listImpactItems([event.id]);
    expect(impacts[event.id]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'object',
          label: 'Review Acme merge',
          href: `/app/objects/merge?ids=${survivor.id},${duplicate.id}&suggestionItemId=${itemId}`,
          status: 'pending',
        }),
        expect.objectContaining({
          kind: 'approval',
          label: 'Review Acme merge',
          href: '/app/approvals',
          status: 'pending',
        }),
      ]),
    );
  });

  it('links accepted board suggestion impact to the board card', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: USER_A,
      source: 'telegram',
      contentText: 'Acme is now in negotiation for the pilot.',
      visibility: 'team',
    });
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Negotiation', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Acme',
      actor: { kind: 'user', userId: USER_A },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Add Acme to pilot pipeline',
      dedupeKey: 'impact-board-membership',
      evidence: [{ rawEventId: event.id }],
      items: [
        {
          operation: 'create',
          targetKind: 'board_membership',
          title: 'Add Acme to Pilot pipeline',
          dedupeKey: 'impact-board-membership:item',
          proposedPayload: {
            boardId: board.id,
            entityId: company.id,
            laneId: board.lanes[0]?.id ?? null,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const impacts = await scope.timeline.listImpactItems([event.id]);
    const boardImpact = impacts[event.id]?.find((impact) => impact.kind === 'board');
    expect(boardImpact?.label).toBe('Add Acme to Pilot pipeline');
    expect(boardImpact?.href).toMatch(new RegExp(`^/app/boards/${board.id}\\?item=`));
    expect(boardImpact?.href).not.toContain('/app/objects/');
    expect(boardImpact?.status).toBe('accepted');
  });

  it('includes all approved facets from the current user linked person object', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Tim Borovkov',
      aliases: ['Timbo'],
      actor: { kind: 'user', userId: USER_A },
    });

    await scope.objects.createIdentityFacet({
      entityId: person.id,
      kind: 'timeline_user',
      value: USER_A,
      linkedUserId: USER_A,
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.objects.createIdentityFacet({
      entityId: person.id,
      kind: 'telegram',
      value: '@timbo0',
      externalId: '12345',
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.objects.createIdentityFacet({
      entityId: person.id,
      kind: 'email',
      value: 'tim@example.com',
      actor: { kind: 'user', userId: USER_A },
    });

    const context = await scope.timeline.currentUserIdentityContext();

    expect(context.person).toMatchObject({
      id: person.id,
      canonicalName: 'Tim Borovkov',
      aliases: ['Timbo'],
    });
    expect(context.facets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'timeline_user', value: USER_A }),
        expect.objectContaining({ kind: 'telegram', value: '@timbo0', externalId: '12345' }),
        expect.objectContaining({ kind: 'email', value: 'tim@example.com' }),
      ]),
    );
    expect(context.facets).toHaveLength(3);

    await db
      .update(objectIdentityFacets)
      .set({ status: 'archived' })
      .where(eq(objectIdentityFacets.value, '@timbo0'));

    const archivedContext = await scope.timeline.currentUserIdentityContext();
    expect(archivedContext.facets.some((facet) => facet.value === '@timbo0')).toBe(false);
  });

  it('rejects visibility edits for ownerless legacy events with a clear error', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const event = await scope.timeline.createEvent({
      authorUserId: null,
      visibilityOwnerUserId: null,
      source: 'system',
      contentText: 'legacy ownerless event',
      visibility: 'team',
    });

    await expect(
      scope.timeline.setEventVisibility(event.id, { visibility: 'private' }),
    ).rejects.toThrow('This event has no visibility owner');
  });

  it('fails integration visibility updates for missing integrations', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);

    await expect(
      scope.integrations.setIntegrationVisibilityDefault(
        '99999999-9999-9999-9999-999999999999',
        'team',
      ),
    ).rejects.toThrow('Integration not found');
  });

  // Provider connections are personal grants, while team integration scopes are
  // admin-activated source paths. This regression covers the ownership,
  // activation, duplicate-source, token, and revocation contracts together.
  it('shares owner resources, activates team sources, replaces duplicate source paths, and records revoked-source attention', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const memberScope = withTeam(db as never, TEAM_A, USER_B);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);

    const ownerConnection = await ownerScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — owner',
      externalAccountId: 'owner-gh',
      scopes: ['repo', 'read:org'],
      tokens: { access_token: 'owner-token' },
    });

    const [storedConnection] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, ownerConnection.id));
    expect(storedConnection?.authSecretCiphertext.toString('utf8')).not.toContain('owner-token');
    await expect(
      ownerScope.integrations.getProviderConnectionTokens(ownerConnection.id),
    ).resolves.toEqual({
      access_token: 'owner-token',
    });
    await expect(
      memberScope.integrations.getProviderConnectionTokens(ownerConnection.id),
    ).resolves.toBeNull();

    await expect(
      memberScope.integrations.shareProviderResources(ownerConnection.id, [
        { kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' },
      ]),
    ).rejects.toThrow('Provider connection not found');

    await ownerScope.integrations.shareProviderResources(ownerConnection.id, [
      { kind: 'github.org', externalId: 'acme', label: 'acme (all accessible repos)' },
      { kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' },
    ]);
    const ownerShares = await ownerScope.integrations.listOwnedTeamResourceShares();
    const orgShare = ownerShares.find((row) => row.share.resourceKind === 'github.org')?.share;
    const ownerRepoShare = ownerShares.find(
      (row) => row.share.resourceKind === 'github.repo',
    )?.share;
    if (!orgShare || !ownerRepoShare) throw new Error('Expected owner shares to be created');
    const memberVisibleShares = await memberScope.integrations.listTeamResourceShares();
    expect(
      memberVisibleShares.some(
        (row) => row.share.id === orgShare.id && row.connection.id === ownerConnection.id,
      ),
    ).toBe(true);

    await expect(
      memberScope.integrations.activateSharedResources({
        providerConnectionId: ownerConnection.id,
        resourceShareIds: [orgShare.id, ownerRepoShare.id],
      }),
    ).rejects.toThrow('admin');

    const ownerIntegration = await adminScope.integrations.activateSharedResources({
      providerConnectionId: ownerConnection.id,
      resourceShareIds: [orgShare.id, ownerRepoShare.id],
    });
    await expect(adminDecryptIntegrationTokens(db as never, ownerIntegration)).resolves.toEqual({
      access_token: 'owner-token',
    });

    const memberConnection = await memberScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — member',
      externalAccountId: 'member-gh',
      scopes: ['repo'],
      tokens: { access_token: 'member-token' },
    });
    await memberScope.integrations.shareProviderResources(memberConnection.id, [
      { kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' },
    ]);
    const memberRepoShare = (await memberScope.integrations.listOwnedTeamResourceShares()).find(
      (row) => row.share.providerConnectionId === memberConnection.id,
    )?.share;
    if (!memberRepoShare) throw new Error('Expected member share to be created');

    await adminScope.integrations.recordConnectionAttention({
      providerConnectionId: ownerConnection.id,
      integrationId: ownerIntegration.id,
      category: 'needs_new_owner',
      summary: 'Connection owner left team — choose a replacement connection',
    });
    await pg.query(
      `UPDATE team_members SET removed_at = now() WHERE team_id = $1 AND user_id = $2`,
      [TEAM_A, USER_A],
    );
    await expect(
      adminScope.integrations.activateSharedResources({
        providerConnectionId: ownerConnection.id,
        resourceShareIds: [ownerRepoShare.id],
      }),
    ).rejects.toThrow('Provider connection owner is no longer a team member');
    const [ownerLeftAttention] = await db
      .select()
      .from(connectionAttention)
      .where(eq(connectionAttention.integrationId, ownerIntegration.id));
    expect(ownerLeftAttention?.category).toBe('needs_new_owner');
    expect(ownerLeftAttention?.resolvedAt).toBeNull();
    await pg.query(
      `UPDATE team_members SET removed_at = NULL WHERE team_id = $1 AND user_id = $2`,
      [TEAM_A, USER_A],
    );

    const memberIntegration = await adminScope.integrations.activateSharedResources({
      providerConnectionId: memberConnection.id,
      resourceShareIds: [memberRepoShare.id],
    });

    const repoSelections = (await db.select().from(integrationSelections)).filter(
      (row) => row.selectionKind === 'github.repo' && row.externalId === 'acme/app',
    );
    expect(repoSelections).toHaveLength(1);
    expect(repoSelections[0]).toMatchObject({
      integrationId: memberIntegration.id,
      resourceShareId: memberRepoShare.id,
    });
    const [resolvedOwnerAttention] = await db
      .select()
      .from(connectionAttention)
      .where(eq(connectionAttention.integrationId, ownerIntegration.id));
    expect(resolvedOwnerAttention?.category).toBe('needs_new_owner');
    expect(resolvedOwnerAttention?.resolvedAt).toBeInstanceOf(Date);

    await ownerScope.integrations.shareProviderResources(ownerConnection.id, [
      { kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' },
    ]);

    const orgSelections = (await db.select().from(integrationSelections)).filter(
      (row) => row.selectionKind === 'github.org' && row.externalId === 'acme',
    );
    expect(orgSelections).toHaveLength(0);
    const [revokedOrgShare] = await db
      .select()
      .from(teamProviderResourceShares)
      .where(eq(teamProviderResourceShares.id, orgShare.id));
    expect(revokedOrgShare?.revokedAt).toBeInstanceOf(Date);
    const attentionRows = await db.select().from(connectionAttention);
    expect(attentionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerConnectionId: ownerConnection.id,
          resourceShareId: orgShare.id,
          category: 'access_changed',
          resolvedAt: null,
        }),
      ]),
    );

    await ownerScope.integrations.shareProviderResources(ownerConnection.id, [
      { kind: 'github.org', externalId: 'acme', label: 'acme (all accessible repos)' },
      { kind: 'github.repo', externalId: 'acme/app', label: 'acme/app' },
    ]);
    const [resolvedOrgAttention] = await db
      .select()
      .from(connectionAttention)
      .where(eq(connectionAttention.resourceShareId, orgShare.id));
    expect(resolvedOrgAttention?.category).toBe('access_changed');
    expect(resolvedOrgAttention?.resolvedAt).toBeInstanceOf(Date);
  });

  it('preserves connection-attention history when a provider connection is deleted', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    const connection = await ownerScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — delete me',
      externalAccountId: 'owner-gh-delete',
      scopes: ['repo'],
      tokens: { access_token: 'owner-token' },
    });
    await ownerScope.integrations.shareProviderResources(connection.id, [
      { kind: 'github.repo', externalId: 'acme/history', label: 'acme/history' },
    ]);
    const [shareRow] = await ownerScope.integrations.listOwnedTeamResourceShares();
    if (!shareRow) throw new Error('Expected owner share');
    const integration = await adminScope.integrations.activateSharedResources({
      providerConnectionId: connection.id,
      resourceShareIds: [shareRow.share.id],
    });
    await ownerScope.integrations.recordConnectionAttention({
      providerConnectionId: connection.id,
      integrationId: integration.id,
      resourceShareId: shareRow.share.id,
      category: 'needs_reconnect',
      summary: 'Reconnect before deleting',
    });

    await ownerScope.integrations.deleteOwnedProviderConnection(connection.id);

    const attentionRows = await db.select().from(connectionAttention);
    const preservedReconnectAttention = attentionRows.find(
      (row) => row.category === 'needs_reconnect',
    );
    expect(preservedReconnectAttention).toMatchObject({
      providerConnectionId: null,
      integrationId: integration.id,
      resourceShareId: null,
      summary: 'Reconnect before deleting',
    });
    expect(preservedReconnectAttention?.resolvedAt).toBeInstanceOf(Date);
    expect(attentionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          integrationId: integration.id,
          category: 'needs_new_owner',
          resolvedAt: null,
        }),
      ]),
    );
    const notificationRows = await db.select().from(notifications);
    expect(notificationRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId: TEAM_A,
          userId: USER_A,
          kind: 'connection_attention',
          summary: 'GitHub — delete me was deleted; choose a replacement connection.',
        }),
        expect.objectContaining({
          teamId: TEAM_A,
          userId: USER_C,
          kind: 'connection_attention',
          summary: 'GitHub — delete me was deleted; choose a replacement connection.',
        }),
      ]),
    );
    expect(
      notificationRows.some((row) => {
        const payload = row.payload as Record<string, unknown>;
        return (
          payload.category === 'needs_new_owner' &&
          payload.integration_id === integration.id &&
          payload.provider_connection_id === null
        );
      }),
    ).toBe(true);
  });

  it('disconnects an integration even when unresolved attention would collide after set-null', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    const connection = await ownerScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — stale attention',
      externalAccountId: 'owner-gh-stale-attention',
      scopes: ['repo'],
      tokens: { access_token: 'owner-token' },
    });
    await ownerScope.integrations.shareProviderResources(connection.id, [
      { kind: 'github.repo', externalId: 'acme/stale', label: 'acme/stale' },
    ]);
    const [shareRow] = await ownerScope.integrations.listOwnedTeamResourceShares();
    if (!shareRow) throw new Error('Expected owner share');
    const integration = await adminScope.integrations.activateSharedResources({
      providerConnectionId: connection.id,
      resourceShareIds: [shareRow.share.id],
    });
    await db.insert(connectionAttention).values([
      {
        teamId: TEAM_A,
        providerConnectionId: connection.id,
        integrationId: integration.id,
        category: 'needs_new_owner',
        summary: 'Integration-scoped owner attention',
      },
      {
        teamId: TEAM_A,
        providerConnectionId: connection.id,
        category: 'needs_new_owner',
        summary: 'Connection-scoped owner attention',
      },
    ]);

    await adminScope.integrations.deleteIntegration(integration.id);

    await expect(
      db.select().from(integrations).where(eq(integrations.id, integration.id)),
    ).resolves.toHaveLength(0);
    const attentionRows = await db.select().from(connectionAttention);
    expect(attentionRows).toEqual([
      expect.objectContaining({
        integrationId: null,
        providerConnectionId: connection.id,
        summary: 'Connection-scoped owner attention',
      }),
    ]);
  });

  it('updates active attention without duplicate notifications and resolves reconnect attention on refresh', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const connection = await ownerScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — owner',
      externalAccountId: 'owner-gh-attention',
      scopes: ['repo'],
      tokens: { access_token: 'old-token' },
    });

    await ownerScope.integrations.recordConnectionAttention({
      providerConnectionId: connection.id,
      category: 'needs_reconnect',
      summary: 'Token expired',
    });
    await ownerScope.integrations.recordConnectionAttention({
      providerConnectionId: connection.id,
      category: 'needs_reconnect',
      summary: 'Token still expired',
    });

    let attentionRows = await db.select().from(connectionAttention);
    expect(attentionRows).toHaveLength(1);
    expect(attentionRows[0]).toMatchObject({
      summary: 'Token still expired',
      resolvedAt: null,
    });
    expect(await db.select().from(notifications)).toHaveLength(1);

    await ownerScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — owner',
      externalAccountId: 'owner-gh-attention',
      scopes: ['repo'],
      tokens: { access_token: 'new-token' },
    });

    attentionRows = await db.select().from(connectionAttention);
    expect(attentionRows[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it('refreshes active team integration scopes when a provider connection reconnects', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    const adminScope = withTeam(db as never, TEAM_A, USER_C);
    const connection = await ownerScope.integrations.upsertProviderConnection({
      provider: 'monday',
      displayName: 'Monday.com — Acme',
      externalAccountId: 'monday-account',
      scopes: ['boards:read', 'users:read', 'updates:read', 'docs:read'],
      tokens: { access_token: 'old-token' },
    });
    await ownerScope.integrations.shareProviderResources(connection.id, [
      { kind: 'monday.board', externalId: 'board-1', label: 'Roadmap' },
    ]);
    const [shareRow] = await ownerScope.integrations.listOwnedTeamResourceShares();
    if (!shareRow) throw new Error('Expected owner share');
    const integration = await adminScope.integrations.activateSharedResources({
      providerConnectionId: connection.id,
      resourceShareIds: [shareRow.share.id],
    });
    await adminScope.integrations.recordConnectionAttention({
      providerConnectionId: connection.id,
      integrationId: integration.id,
      category: 'needs_reconnect',
      summary: 'Monday scopes are missing',
    });

    await ownerScope.integrations.upsertProviderConnection({
      provider: 'monday',
      displayName: 'Monday.com — Acme',
      externalAccountId: 'monday-account',
      scopes: [
        'boards:read',
        'users:read',
        'updates:read',
        'docs:read',
        'account:read',
        'webhooks:read',
        'webhooks:write',
      ],
      tokens: { access_token: 'new-token' },
    });

    const [refreshedIntegration] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integration.id));
    expect(refreshedIntegration?.scopes).toEqual([
      'boards:read',
      'users:read',
      'updates:read',
      'docs:read',
      'account:read',
      'webhooks:read',
      'webhooks:write',
    ]);
    await expect(adminDecryptIntegrationTokens(db as never, integration)).resolves.toEqual({
      access_token: 'new-token',
    });
    const [attentionRow] = await db
      .select()
      .from(connectionAttention)
      .where(eq(connectionAttention.integrationId, integration.id));
    expect(attentionRow?.resolvedAt).toBeInstanceOf(Date);
  });

  it('resolves reconnect attention for the provider connection across every shared team', async () => {
    const teamAScope = withTeam(db as never, TEAM_A, USER_A);
    const teamBScope = withTeam(db as never, TEAM_B, USER_A);
    const connection = await teamAScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — owner',
      externalAccountId: 'owner-gh-cross-team',
      scopes: ['repo'],
      tokens: { access_token: 'old-token' },
    });

    await teamAScope.integrations.recordConnectionAttention({
      providerConnectionId: connection.id,
      category: 'needs_reconnect',
      summary: 'Team A token expired',
    });
    await teamBScope.integrations.recordConnectionAttention({
      providerConnectionId: connection.id,
      category: 'needs_reconnect',
      summary: 'Team B token expired',
    });

    await teamAScope.integrations.upsertProviderConnection({
      provider: 'github',
      displayName: 'GitHub — owner',
      externalAccountId: 'owner-gh-cross-team',
      scopes: ['repo'],
      tokens: { access_token: 'new-token' },
    });

    const attentionRows = await db.select().from(connectionAttention);
    expect(attentionRows).toHaveLength(2);
    expect(attentionRows.every((row) => row.resolvedAt instanceof Date)).toBe(true);
  });

  it('throttles connection-attention email per target and category', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <timeline@example.test>';
    process.env.AUTH_URL = 'https://timeline.example.test';
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ownerScope = withTeam(db as never, TEAM_A, USER_A);
      const connection = await ownerScope.integrations.upsertProviderConnection({
        provider: 'github',
        displayName: 'GitHub — owner',
        externalAccountId: 'owner-gh-email',
        scopes: ['repo'],
        tokens: { access_token: 'token' },
      });

      await ownerScope.integrations.recordConnectionAttention({
        providerConnectionId: connection.id,
        category: 'needs_reconnect',
        summary: 'Reconnect GitHub',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await ownerScope.integrations.recordConnectionAttention({
        providerConnectionId: connection.id,
        category: 'sync_error',
        summary: 'GitHub sync failed repeatedly',
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);

      await ownerScope.integrations.resolveConnectionAttention({
        providerConnectionId: connection.id,
        categories: ['sync_error'],
      });
      await ownerScope.integrations.recordConnectionAttention({
        providerConnectionId: connection.id,
        category: 'sync_error',
        summary: 'GitHub sync failed repeatedly again',
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);

      await db
        .update(connectionAttention)
        .set({ lastEmailedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
        .where(eq(connectionAttention.category, 'sync_error'));
      await ownerScope.integrations.resolveConnectionAttention({
        providerConnectionId: connection.id,
        categories: ['sync_error'],
      });
      await ownerScope.integrations.recordConnectionAttention({
        providerConnectionId: connection.id,
        category: 'sync_error',
        summary: 'GitHub sync failed after a day',
      });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.POSTMARK_SERVER_TOKEN;
      delete process.env.TRANSACTIONAL_EMAIL_FROM;
      delete process.env.AUTH_URL;
    }
  });

  it('tracks transient sync failures in integration sync state without a schema migration', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const integration = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub',
      externalAccountId: 'transient-state',
    });

    await expect(
      adminRecordTransientSyncFailure(db as never, integration.id, 'temporarily overloaded'),
    ).resolves.toEqual({ count: 1, shouldCreateAttention: false });
    await expect(
      adminRecordTransientSyncFailure(db as never, integration.id, 'temporarily overloaded'),
    ).resolves.toEqual({ count: 2, shouldCreateAttention: false });
    await expect(
      adminRecordTransientSyncFailure(db as never, integration.id, 'temporarily overloaded'),
    ).resolves.toEqual({ count: 3, shouldCreateAttention: true });

    const [row] = await db
      .select()
      .from(integrationSyncState)
      .where(eq(integrationSyncState.resourceType, 'integration.run'));
    expect(row).toMatchObject({
      cursor: { transient_failure_count: 3 },
      lastStatus: 'failed',
      lastError: 'temporarily overloaded',
    });

    await adminResetTransientSyncFailures(db as never, integration.id);
    const [resetRow] = await db
      .select()
      .from(integrationSyncState)
      .where(eq(integrationSyncState.resourceType, 'integration.run'));
    expect(resetRow).toMatchObject({
      cursor: { transient_failure_count: 0 },
      lastStatus: 'ok',
      lastError: null,
    });
  });

  it('preserves per-integration visibility defaults when reconnecting', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const first = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub',
      externalAccountId: 'installation-1',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });

    const second = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub reconnected',
      externalAccountId: 'installation-1',
      visibilityDefault: 'team',
      visibilityDefaultUserIds: null,
    });

    expect(second.id).toBe(first.id);
    const [row] = await db.select().from(integrations).where(eq(integrations.id, first.id));
    expect(row).toMatchObject({
      displayName: 'GitHub reconnected',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });
  });

  it('does not validate discarded reconnect visibility defaults', async () => {
    const scope = withTeam(db as never, TEAM_A, USER_A);
    const first = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub',
      externalAccountId: 'installation-stale-default',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });

    const second = await scope.integrations.createIntegration({
      provider: 'github',
      displayName: 'GitHub reconnected',
      externalAccountId: 'installation-stale-default',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: ['99999999-9999-9999-9999-999999999999'],
    });

    expect(second.id).toBe(first.id);
    const [row] = await db.select().from(integrations).where(eq(integrations.id, first.id));
    expect(row).toMatchObject({
      displayName: 'GitHub reconnected',
      visibilityDefault: 'specific_users',
      visibilityDefaultUserIds: [USER_B],
    });
  });

  it('lists active members for the current team', async () => {
    const ownerScope = withTeam(db as never, TEAM_A, USER_A);
    await expect(ownerScope.timeline.listMembers()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: USER_A, role: 'owner' }),
        expect.objectContaining({ userId: USER_C, role: 'admin' }),
      ]),
    );
  });
});
