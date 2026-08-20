import { PGlite } from '@electric-sql/pglite';
import { rawEvents, reconciliationEvidence, reconciliationEvidenceAnchors } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordMcpToolResultEvidence } from '#src/reconciliation/mcp-capture.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const queueMocks = vi.hoisted(() => ({
  enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#src/queue/queues.js', () => ({
  enqueueEmbedJob: queueMocks.enqueueEmbedJob,
}));

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SERVER_ID = '33333333-3333-4333-8333-333333333333';
const TOOL_NAME = 'search';
const NAMESPACED_TOOL_NAME = 'mcp__33333333333343338333333333333333__search';

describe('MCP reconciliation capture', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    queueMocks.enqueueEmbedJob.mockClear();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'mcp-capture', 'MCP Capture');
      INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('records private replayable raw events and normalized evidence for MCP tool results', async () => {
    const result = await recordMcpToolResultEvidence({
      db: db as never,
      teamId: TEAM_ID,
      actorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      serverId: SERVER_ID,
      serverName: 'Research MCP',
      toolName: TOOL_NAME,
      namespacedToolName: NAMESPACED_TOOL_NAME,
      args: { q: 'Acme rollout' },
      result: {
        content: [
          {
            type: 'text',
            text: 'Acme rollout is blocked by the SSO incident.',
          },
        ],
      },
      occurredAt: new Date('2026-07-02T08:00:00.000Z'),
    });

    expect(result.replayState).toBe('full');
    expect(result.evidenceIds).toHaveLength(1);
    expect(queueMocks.enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'raw_event',
      teamId: TEAM_ID,
      rawEventId: result.rawEventId,
    });

    const [raw] = await db.select().from(rawEvents).where(eq(rawEvents.id, result.rawEventId));
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, result.rawEventId));
    const anchors = await db
      .select()
      .from(reconciliationEvidenceAnchors)
      .where(eq(reconciliationEvidenceAnchors.evidenceId, evidence?.id ?? ''));

    expect(raw).toMatchObject({
      source: 'integration',
      authorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
    });
    expect(raw?.contentText).toContain('Acme rollout is blocked');
    expect(raw?.sourceMetadata).toMatchObject({
      provider: 'mcp',
      event_type: 'mcp.tool_result',
      mcp_server_id: SERVER_ID,
      mcp_server_name: 'Research MCP',
      mcp_tool_name: TOOL_NAME,
      mcp_namespaced_tool_name: NAMESPACED_TOOL_NAME,
      source_snapshot_kind: 'mcp_tool_result',
      source_snapshot_version: 'mcp-tool-result-snapshot-2026-07',
      replay_degraded_reason: null,
    });
    const metadata = raw?.sourceMetadata as {
      dedup_key?: string;
      source_payload_ref?: string;
      payload_digest?: string;
      source_snapshot?: { args?: unknown; result?: unknown };
      mcp_call_id?: string;
    };
    expect(metadata.dedup_key).toMatch(/^mcp:v2:private:/);
    expect(metadata.source_payload_ref).toMatch(/^inline:\/\/timeline\/mcp\//);
    expect(metadata.payload_digest).toMatch(/^sha256:/);
    expect(metadata.mcp_call_id).toMatch(/^sha256:/);
    expect(metadata.source_snapshot).toMatchObject({
      args: { q: 'Acme rollout' },
      result: {
        content: [
          {
            type: 'text',
            text: 'Acme rollout is blocked by the SSO incident.',
          },
        ],
      },
    });
    expect(evidence).toMatchObject({
      rawEventId: result.rawEventId,
      source: 'integration',
      provider: 'mcp',
      externalObjectId: `${SERVER_ID}:${TOOL_NAME}`,
      externalEventId: metadata.mcp_call_id,
      replayState: 'full',
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      sourcePayloadRef: metadata.source_payload_ref,
      payloadDigest: metadata.payload_digest,
    });
    expect(
      anchors.map((anchor) => [anchor.anchorType, anchor.anchorValue, anchor.strength]),
    ).toEqual(
      expect.arrayContaining([
        ['mcp_server', SERVER_ID, 'provider'],
        ['mcp_tool', NAMESPACED_TOOL_NAME, 'provider'],
        ['mcp_call', metadata.mcp_call_id, 'hard'],
      ]),
    );
  });

  it('dedupes repeated MCP tool result captures by server, tool, args, and result', async () => {
    const input = {
      db: db as never,
      teamId: TEAM_ID,
      actorUserId: USER_ID,
      visibility: 'private' as const,
      visibilityOwnerUserId: USER_ID,
      serverId: SERVER_ID,
      serverName: 'Research MCP',
      toolName: TOOL_NAME,
      namespacedToolName: NAMESPACED_TOOL_NAME,
      args: { q: 'Acme rollout' },
      result: { content: [{ type: 'text', text: 'same answer' }] },
      occurredAt: new Date('2026-07-02T08:00:00.000Z'),
    };

    const first = await recordMcpToolResultEvidence(input);
    const second = await recordMcpToolResultEvidence(input);
    const rawRows = await db.select().from(rawEvents);
    const evidenceRows = await db.select().from(reconciliationEvidence);

    expect(second.rawEventId).toBe(first.rawEventId);
    expect(queueMocks.enqueueEmbedJob).toHaveBeenCalledTimes(1);
    expect(rawRows).toHaveLength(1);
    expect(evidenceRows).toHaveLength(1);
  });

  it('captures team-shared results as team evidence without broadening private captures', async () => {
    const common = {
      db: db as never,
      teamId: TEAM_ID,
      serverId: SERVER_ID,
      serverName: 'Research MCP',
      toolName: TOOL_NAME,
      namespacedToolName: NAMESPACED_TOOL_NAME,
      args: { q: 'Acme rollout' },
      result: { content: [{ type: 'text', text: 'same answer' }] },
      occurredAt: new Date('2026-07-02T08:05:00.000Z'),
    };
    const privateCapture = await recordMcpToolResultEvidence({
      ...common,
      actorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
    });
    const teamCapture = await recordMcpToolResultEvidence({
      ...common,
      actorUserId: null,
      visibility: 'team',
      visibilityOwnerUserId: null,
      invocationSurface: 'mcp',
      syntheticActorKind: 'team_agent',
      mcpOutboundKeyId: '44444444-4444-4444-8444-444444444444',
    });

    expect(teamCapture.rawEventId).not.toBe(privateCapture.rawEventId);
    const rows = await db.select().from(rawEvents);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === privateCapture.rawEventId)).toMatchObject({
      authorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
    });
    const teamRow = rows.find((row) => row.id === teamCapture.rawEventId);
    expect(teamRow).toMatchObject({
      authorUserId: null,
      visibility: 'team',
      visibilityOwnerUserId: null,
    });
    expect(teamRow?.sourceMetadata).toMatchObject({
      mcp_server_scope: 'team',
      invocation_surface: 'mcp',
      synthetic_actor_kind: 'team_agent',
      mcp_outbound_key_id: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('never reuses or broadens a legacy private MCP capture', async () => {
    const legacyId = '55555555-5555-4555-8555-555555555555';
    await db.insert(rawEvents).values({
      id: legacyId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: '{"content":"legacy private result"}',
      occurredAt: new Date('2026-07-01T08:00:00.000Z'),
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      sourceMetadata: {
        provider: 'mcp',
        event_type: 'mcp.tool_result',
        dedup_key: `mcp:${SERVER_ID}:${NAMESPACED_TOOL_NAME}:legacy`,
      },
    });

    const teamCapture = await recordMcpToolResultEvidence({
      db: db as never,
      teamId: TEAM_ID,
      actorUserId: null,
      visibility: 'team',
      visibilityOwnerUserId: null,
      serverId: SERVER_ID,
      serverName: 'Research MCP',
      toolName: TOOL_NAME,
      namespacedToolName: NAMESPACED_TOOL_NAME,
      args: { q: 'legacy' },
      result: { content: 'legacy private result' },
      occurredAt: new Date('2026-07-02T08:05:00.000Z'),
    });

    expect(teamCapture.rawEventId).not.toBe(legacyId);
    const [legacy] = await db.select().from(rawEvents).where(eq(rawEvents.id, legacyId));
    expect(legacy).toMatchObject({
      authorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
    });
  });

  it('marks oversized MCP tool results as replay-degraded without inline payload refs', async () => {
    const result = await recordMcpToolResultEvidence({
      db: db as never,
      teamId: TEAM_ID,
      actorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      serverId: SERVER_ID,
      serverName: 'Research MCP',
      toolName: TOOL_NAME,
      namespacedToolName: NAMESPACED_TOOL_NAME,
      args: { q: 'Acme rollout' },
      result: { text: 'x'.repeat(33_000) },
      occurredAt: new Date('2026-07-02T08:15:00.000Z'),
    });

    expect(result.replayState).toBe('degraded');
    expect(result.evidenceIds).toHaveLength(1);

    const [raw] = await db.select().from(rawEvents).where(eq(rawEvents.id, result.rawEventId));
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, result.rawEventId));
    const metadata = raw?.sourceMetadata as {
      source_payload_ref?: string | null;
      payload_digest?: string | null;
      source_snapshot?: unknown;
      replay_degraded_reason?: string | null;
    };

    expect(raw?.contentText ?? '').toHaveLength(32_000);
    expect(metadata.source_payload_ref).toBeNull();
    expect(metadata.payload_digest).toBeNull();
    expect(metadata.source_snapshot).toBeNull();
    expect(metadata.replay_degraded_reason).toBe('mcp_tool_result_too_large');
    expect(evidence).toMatchObject({
      rawEventId: result.rawEventId,
      replayState: 'degraded',
      sourcePayloadRef: null,
      payloadDigest: null,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
    });
  });

  it('extracts provider object anchors from structured MCP tool result snapshots', async () => {
    const result = await recordMcpToolResultEvidence({
      db: db as never,
      teamId: TEAM_ID,
      actorUserId: USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      serverId: SERVER_ID,
      serverName: 'Ops MCP',
      toolName: 'get_issue',
      namespacedToolName: 'mcp__33333333333343338333333333333333__get_issue',
      args: { provider: 'sentry', externalObjectId: 'sentry-issue-100' },
      result: {
        provider: 'sentry',
        externalObjectId: 'sentry-issue-100',
        externalEventId: 'event-100',
        externalUrl: 'https://sentry.example/issues/sentry-issue-100/',
        status: 'unresolved',
        level: 'error',
      },
      occurredAt: new Date('2026-07-02T08:30:00.000Z'),
    });

    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, result.rawEventId));
    const anchors = await db
      .select()
      .from(reconciliationEvidenceAnchors)
      .where(eq(reconciliationEvidenceAnchors.evidenceId, evidence?.id ?? ''));

    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'mcp_tool',
          anchorValue: 'mcp__33333333333343338333333333333333__get_issue',
          strength: 'provider',
        }),
        expect.objectContaining({
          anchorType: 'provider_object',
          anchorValue: 'sentry:sentry-issue-100',
          strength: 'provider',
        }),
        expect.objectContaining({
          anchorType: 'provider_external:sentry',
          anchorValue: 'sentry-issue-100',
          strength: 'hard',
        }),
        expect.objectContaining({
          anchorType: 'provider_event',
          anchorValue: 'sentry:event-100',
          strength: 'provider',
        }),
        expect.objectContaining({
          anchorType: 'url',
          anchorValue: 'https://sentry.example/issues/sentry-issue-100',
          strength: 'hard',
        }),
      ]),
    );
  });
});
