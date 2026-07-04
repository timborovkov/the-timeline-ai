import { type Db, rawEvents } from '@timeline/db';
import { and, eq, sql } from 'drizzle-orm';

import { enqueueEmbedJob } from '#src/queue/queues.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { stableSha256Digest } from '#src/reconciliation/stable-digest.js';
import { stableJson } from '#src/reconciliation/stable-json.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

const MCP_TOOL_RESULT_SNAPSHOT_VERSION = 'mcp-tool-result-snapshot-2026-07';
const MAX_INLINE_MCP_TOOL_RESULT_BYTES = 32_000;

export interface RecordMcpToolResultEvidenceInput {
  db: DbOrTx;
  teamId: string;
  userId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  namespacedToolName: string;
  args: Record<string, unknown>;
  result: unknown;
  occurredAt?: Date;
}

export interface RecordMcpToolResultEvidenceResult {
  rawEventId: string;
  evidenceIds: string[];
  replayState: 'full' | 'degraded';
}

export async function recordMcpToolResultEvidence(
  input: RecordMcpToolResultEvidenceInput,
): Promise<RecordMcpToolResultEvidenceResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const resultText = stableJson(input.result);
  const argsDigest = stableSha256Digest(input.args);
  const resultDigest = stableSha256Digest(input.result);
  const callId = stableSha256Digest({
    serverId: input.serverId,
    namespacedToolName: input.namespacedToolName,
    argsDigest,
    resultDigest,
  });
  const dedupKey = `mcp:${input.serverId}:${input.namespacedToolName}:${callId.slice(
    'sha256:'.length,
  )}`;
  const inlineSnapshot =
    Buffer.byteLength(resultText, 'utf8') <= MAX_INLINE_MCP_TOOL_RESULT_BYTES
      ? {
          serverId: input.serverId,
          serverName: input.serverName,
          toolName: input.toolName,
          namespacedToolName: input.namespacedToolName,
          args: input.args,
          result: input.result,
        }
      : null;
  const sourcePayloadRef = inlineSnapshot
    ? `inline://timeline/mcp/${input.serverId}/${callId.slice('sha256:'.length)}`
    : null;
  const payloadDigest = inlineSnapshot ? resultDigest : null;
  const replayState = inlineSnapshot ? 'full' : 'degraded';

  const [inserted] = await input.db
    .insert(rawEvents)
    .values({
      teamId: input.teamId,
      authorUserId: input.userId,
      source: 'integration',
      contentText: resultText.slice(0, MAX_INLINE_MCP_TOOL_RESULT_BYTES),
      occurredAt,
      visibility: 'private',
      visibilityOwnerUserId: input.userId,
      sourceMetadata: {
        provider: 'mcp',
        event_type: 'mcp.tool_result',
        dedup_key: dedupKey,
        external_object_id: `${input.serverId}:${input.toolName}`,
        external_event_id: callId,
        mcp_server_id: input.serverId,
        mcp_server_name: input.serverName,
        mcp_tool_name: input.toolName,
        mcp_namespaced_tool_name: input.namespacedToolName,
        mcp_call_id: callId,
        args_digest: argsDigest,
        result_digest: resultDigest,
        source_payload_ref: sourcePayloadRef,
        payload_digest: payloadDigest,
        source_snapshot_kind: inlineSnapshot ? 'mcp_tool_result' : null,
        source_snapshot_version: inlineSnapshot ? MCP_TOOL_RESULT_SNAPSHOT_VERSION : null,
        source_snapshot: inlineSnapshot,
        replay_degraded_reason: inlineSnapshot ? null : 'mcp_tool_result_too_large',
      },
    })
    .onConflictDoNothing()
    .returning({ id: rawEvents.id });

  const rawEventId =
    inserted?.id ??
    (
      await input.db
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, input.teamId),
            sql`${rawEvents.sourceMetadata} ->> 'dedup_key' = ${dedupKey}`,
          ),
        )
        .limit(1)
    )[0]?.id;
  if (!rawEventId) throw new Error('Failed to record MCP tool result raw event');
  if (inserted) {
    await enqueueEmbedJob({ scope: 'raw_event', teamId: input.teamId, rawEventId });
  }

  const evidenceIds = await normalizeRawEventsToEvidence({
    db: input.db,
    teamId: input.teamId,
    rawEventIds: [rawEventId],
  });
  return { rawEventId, evidenceIds, replayState };
}
