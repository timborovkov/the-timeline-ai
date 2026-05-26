import { type Db, documents as documentsTable, getDbClient } from '@timeline/db';
import {
  childLogger,
  getDocumentsBucket,
  getS3Client,
  integrations as integrationsLib,
  putObject,
  queue,
  withTeam,
} from '@timeline/shared';
import { Worker, type Job } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';

// Phase 11 — Integration sync worker.
//
// Two job kinds:
//   - `backfill`: full walk of selected resources for one integration.
//     Enqueued from the settings UI or admin script.
//   - `incremental`: delta sync from the per-resource cursor. The 5-min
//     repeatable tick fans this out to every enabled integration via a
//     synthetic tick job (integrationId='__tick__').

const log = childLogger('worker:integration-sync');

interface IntegrationSyncDeps {
  db: Db;
}

async function runOneIntegration(
  db: Db,
  integrationId: string,
  kind: 'backfill' | 'incremental',
): Promise<void> {
  // Per-integration session-scoped advisory lock. With worker
  // concurrency=2 + no jobId dedup, the 5-min tick can race with a
  // webhook-triggered enqueue for the same integration. Both runs would
  // walk the same cursor and burn provider API quota in parallel.
  // `pg_try_advisory_lock` returns false instantly if another session
  // holds the lock; we skip this run and let the in-flight one finish.
  //
  // Session locks live on the connection that acquired them. Drizzle's
  // pooled client picks a different connection per query, so a naive
  // `db.execute(pg_advisory_unlock)` would no-op on a different
  // connection and strand the lock until the original was recycled.
  // Pin one connection across both acquire + release via
  // `postgres.reserve()`. The actual sync uses normal pooled
  // connections — only the two lock statements need pinning.
  const reserved = await getDbClient().reserve();
  const lockRows =
    (await reserved`SELECT pg_try_advisory_lock(hashtextextended(${integrationId}::text, 0)) AS locked`) as unknown as {
      locked: boolean;
    }[];
  const lockedRow = lockRows[0];
  if (!lockedRow?.locked) {
    log.info({ integrationId, kind }, 'integration sync already running — skipping this tick');
    reserved.release();
    return;
  }
  try {
    const integration = await integrationsLib.adminLoadIntegration(db, integrationId);
    if (!integration) {
      log.warn({ integrationId }, 'integration not found');
      return;
    }
    if (!integration.enabled) {
      log.debug({ integrationId }, 'integration disabled — skipping');
      return;
    }
    if (integration.provider === 'mcp') {
      // MCP servers are queried on-demand by the agent — no scheduled
      // sync. We skip cleanly so a future "MCP poll" extension is
      // additive.
      return;
    }
    const tokens = integrationsLib.adminDecryptTokens(integration);
    if (!tokens) {
      await integrationsLib.adminRecordError(db, integrationId, 'No tokens — reconnect required');
      return;
    }
    const provider = integrationsLib.getProvider(integration.provider);
    const selections = await integrationsLib.adminListSelections(db, integrationId);

    // Document harvest is opt-in per provider and requires the integration
    // to have a connected user we can attribute uploads to. For
    // headless / system integrations (no connectedByUserId) we skip the
    // hook entirely — the integration_event row still lands.
    const harvestableUserId = integration.connectedByUserId;
    const harvestEnabled = integration.provider === 'google_drive' && harvestableUserId !== null;

    const ctx: integrationsLib.SyncContext = {
      async writeEvents(events) {
        return integrationsLib.writeIntegrationEvents({ db, integration, events });
      },
      async recordAudit(auditKind, payload) {
        await integrationsLib.adminRecordAudit(db, integration.teamId, auditKind, payload, {
          integrationId,
        });
      },
      async saveCursor(resourceType, cursor) {
        await integrationsLib.adminSaveCursor(db, integrationId, resourceType, cursor);
      },
      async loadCursor(resourceType) {
        return integrationsLib.adminLoadCursor(db, integrationId, resourceType);
      },
      ...(harvestEnabled && harvestableUserId
        ? {
            async harvestDocument(input) {
              const scope = withTeam(db, integration.teamId, harvestableUserId);
              // Idempotency: look up an existing document via the
              // `metadata->>'external_id'` jsonb path keyed on this
              // provider. If we've harvested this Drive file before, add a
              // new version; otherwise create a fresh document.
              const existing = await db
                .select()
                .from(documentsTable)
                .where(
                  and(
                    eq(documentsTable.teamId, integration.teamId),
                    sql`(${documentsTable.metadata} ->> 'integration_external_id') = ${input.externalId}`,
                    sql`(${documentsTable.metadata} ->> 'integration_provider') = ${integration.provider}`,
                  ),
                )
                .limit(1);
              let documentId: string;
              let versionId: string;
              let objectKey: string;
              let contentType: string;
              if (existing.length > 0 && existing[0]) {
                const doc = existing[0];
                const version = await scope.addDocumentVersion({
                  documentId: doc.id,
                  filename: input.filename,
                  contentType: input.contentType,
                });
                documentId = doc.id;
                versionId = version.id;
                objectKey = version.objectKey;
                contentType = version.contentType ?? input.contentType;
              } else {
                const created = await scope.createDocument({
                  name: input.filename,
                  filename: input.filename,
                  contentType: input.contentType,
                  metadata: {
                    ...(input.metadata ?? {}),
                    integration_id: integration.id,
                    integration_provider: integration.provider,
                    integration_external_id: input.externalId,
                  },
                });
                documentId = created.document.id;
                versionId = created.version.id;
                objectKey = created.version.objectKey;
                contentType = created.version.contentType ?? input.contentType;
              }
              // Upload bytes to S3.
              await putObject(getS3Client(), {
                bucket: getDocumentsBucket(),
                key: objectKey,
                body: input.body,
                contentType,
              });
              // Finalize the version and enqueue extraction.
              await scope.finalizeDocumentVersion({
                versionId,
                contentType,
                byteSize: input.body.byteLength,
              });
              await queue.enqueueDocumentExtractJob({
                documentVersionId: versionId,
                teamId: integration.teamId,
              });
              return { documentId, versionId };
            },
          }
        : {}),
    };
    await integrationsLib.adminRecordAudit(
      db,
      integration.teamId,
      `sync_started:${kind}`,
      { provider: integration.provider },
      { integrationId },
    );
    try {
      if (kind === 'backfill') {
        await provider.backfill({ integration, tokens, selections, ctx });
      } else {
        await provider.incrementalSync({ integration, tokens, selections, ctx });
      }
      await integrationsLib.adminMarkSynced(db, integrationId);
      await integrationsLib.adminRecordAudit(
        db,
        integration.teamId,
        `sync_finished:${kind}`,
        { provider: integration.provider },
        { integrationId },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err, integrationId }, 'integration sync failed');
      await integrationsLib.adminRecordError(db, integrationId, msg);
      await integrationsLib.adminRecordAudit(
        db,
        integration.teamId,
        `sync_failed:${kind}`,
        { provider: integration.provider, error: msg },
        { integrationId },
      );
      throw err;
    }
  } finally {
    // Release the session lock on the SAME connection that acquired it
    // (see `reserved` above), then return that connection to the pool.
    try {
      await reserved`SELECT pg_advisory_unlock(hashtextextended(${integrationId}::text, 0))`;
    } catch {
      // Swallow — the connection may have died mid-sync, in which case
      // the lock is auto-released by Postgres anyway.
    }
    reserved.release();
  }
}

async function handleTick(db: Db): Promise<void> {
  const all = await integrationsLib.adminListEnabledIntegrations(db);
  for (const i of all) {
    if (i.provider === 'mcp') continue;
    try {
      await queue.enqueueIntegrationSyncJob({
        kind: 'incremental',
        integrationId: i.id,
        teamId: i.teamId,
        triggeredBy: 'tick',
      });
    } catch (err) {
      log.warn({ err, integrationId: i.id }, 'failed to enqueue per-integration tick');
    }
  }
}

export function startIntegrationSyncWorker(
  deps: IntegrationSyncDeps,
): Worker<queue.IntegrationSyncJobData> {
  const worker = new Worker<queue.IntegrationSyncJobData>(
    queue.QUEUE_NAMES.integrationSync,
    async (job: Job<queue.IntegrationSyncJobData>) => {
      const startedAt = Date.now();
      const data = job.data;
      if (data.integrationId === '__tick__') {
        await handleTick(deps.db);
        return { ticked: true, durationMs: Date.now() - startedAt };
      }
      await runOneIntegration(deps.db, data.integrationId, data.kind);
      return {
        integrationId: data.integrationId,
        kind: data.kind,
        durationMs: Date.now() - startedAt,
      };
    },
    {
      connection: queue.getRedisConnection(),
      concurrency: 2,
    },
  );
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'integration sync failed');
  });
  return worker;
}
