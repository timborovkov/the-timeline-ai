import { createHash } from 'node:crypto';

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
import {
  payloadDigestFromMetadata,
  sourcePayloadRefFromMetadata,
} from '@timeline/shared/reconciliation';
import { Worker, type Job } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';

import { captureWorkerException, captureWorkerJobFailure } from '#src/monitoring.js';

// Phase 11 — Integration sync worker.
//
// Two job kinds:
//   - `backfill`: full walk of selected resources for one integration.
//     Enqueued from the settings UI or admin script.
//   - `incremental`: delta sync from the per-resource cursor. The 5-min
//     repeatable tick fans this out to every enabled integration via a
//     synthetic tick job (integrationId='__tick__').

const log = childLogger('worker:integration-sync');
type NativeSyncProvider = integrationsLib.NativeProviderId;
const HARVESTED_DOCUMENT_SOURCE_SNAPSHOT_VERSION = 'integration-document-source-snapshot-2026-07';
const PAGINATION_LOCK_RETRY_DELAY_MS = 5_000;
const MAX_PAGINATION_LOCK_RETRY_ATTEMPTS = 3;

type TargetedIntegrationSyncJob = Extract<queue.IntegrationSyncJobData, { kind: 'targeted' }>;

function delayUntil(retryAt: Date): number | undefined {
  const delayMs = retryAt.getTime() - Date.now();
  return delayMs > 0 ? delayMs : undefined;
}

function isProviderPaginationContinuation(
  target: TargetedIntegrationSyncJob | undefined,
): target is TargetedIntegrationSyncJob {
  return target?.reason === 'provider_pagination_continuation';
}

interface IntegrationSyncDeps {
  db: Db;
}

export interface IntegrationDocumentHarvestIO {
  getDocumentsBucket: () => string;
  putDocumentObject: (input: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
  }) => Promise<void>;
  enqueueDocumentExtractJob: (data: queue.DocumentExtractJobData) => Promise<void>;
}

const defaultDocumentHarvestIO: IntegrationDocumentHarvestIO = {
  getDocumentsBucket,
  async putDocumentObject(input) {
    await putObject(getS3Client(), input);
  },
  enqueueDocumentExtractJob: queue.enqueueDocumentExtractJob,
};

export async function harvestIntegrationDocument(input: {
  db: Db;
  integration: Pick<integrationsLib.IntegrationRow, 'id' | 'teamId' | 'provider'>;
  harvestUserId: string;
  document: integrationsLib.HarvestDocumentInput;
  io?: IntegrationDocumentHarvestIO;
}): Promise<{ documentId: string; versionId: string }> {
  const io = input.io ?? defaultDocumentHarvestIO;
  const scope = withTeam(input.db, input.integration.teamId, input.harvestUserId);
  const documentMetadata = {
    ...(input.document.metadata ?? {}),
    integration_id: input.integration.id,
    integration_provider: input.integration.provider,
    integration_external_id: input.document.externalId,
  };
  const existing = await input.db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.teamId, input.integration.teamId),
        sql`(${documentsTable.metadata} ->> 'integration_external_id') = ${input.document.externalId}`,
        sql`(${documentsTable.metadata} ->> 'integration_provider') = ${input.integration.provider}`,
      ),
    )
    .limit(1);
  let documentId: string;
  let versionId: string;
  let objectKey: string;
  let contentType: string;
  if (existing.length > 0 && existing[0]) {
    const doc = existing[0];
    const version = await scope.documents.addDocumentVersion({
      documentId: doc.id,
      filename: input.document.filename,
      contentType: input.document.contentType,
    });
    documentId = doc.id;
    versionId = version.id;
    objectKey = version.objectKey;
    contentType = version.contentType ?? input.document.contentType;
  } else {
    const created = await scope.documents.createDocument({
      name: input.document.filename,
      filename: input.document.filename,
      contentType: input.document.contentType,
      metadata: documentMetadata,
    });
    documentId = created.document.id;
    versionId = created.version.id;
    objectKey = created.version.objectKey;
    contentType = created.version.contentType ?? input.document.contentType;
  }
  const bucket = io.getDocumentsBucket();
  const checksumSha256 = createHash('sha256').update(input.document.body).digest('hex');
  await io.putDocumentObject({
    bucket,
    key: objectKey,
    body: input.document.body,
    contentType,
  });
  await scope.documents.finalizeDocumentVersion({
    versionId,
    contentType,
    byteSize: input.document.body.byteLength,
    checksumSha256,
    sourceMetadata: harvestedDocumentSourceMetadata({
      bucket,
      checksumSha256,
      contentType,
      document: input.document,
      documentMetadata,
      integration: input.integration,
      objectKey,
    }),
  });
  await io.enqueueDocumentExtractJob({
    documentVersionId: versionId,
    teamId: input.integration.teamId,
  });
  return { documentId, versionId };
}

function harvestedDocumentSourceMetadata(input: {
  bucket: string;
  checksumSha256: string;
  contentType: string;
  document: integrationsLib.HarvestDocumentInput;
  documentMetadata: Record<string, unknown>;
  integration: Pick<integrationsLib.IntegrationRow, 'id' | 'provider'>;
  objectKey: string;
}): Record<string, unknown> {
  const payloadRef =
    sourcePayloadRefFromMetadata(input.document.metadata) ??
    `s3://${input.bucket}/${input.objectKey}`;
  const digest =
    payloadDigestFromMetadata(input.document.metadata) ?? `sha256:${input.checksumSha256}`;
  return {
    ...withoutReplayMetadataAliases(input.documentMetadata),
    source_payload_ref: payloadRef,
    payload_digest: digest,
    source_snapshot_kind: 'integration_harvest_document',
    source_snapshot_version: HARVESTED_DOCUMENT_SOURCE_SNAPSHOT_VERSION,
    source_snapshot: {
      provider: input.integration.provider,
      integrationId: input.integration.id,
      externalObjectId: input.document.externalId,
      filename: input.document.filename,
      contentType: input.contentType,
      byteSize: input.document.body.byteLength,
      checksumSha256: input.checksumSha256,
      objectKey: input.objectKey,
      metadata: input.document.metadata ?? {},
    },
  };
}

function withoutReplayMetadataAliases(metadata: Record<string, unknown>): Record<string, unknown> {
  const result = { ...metadata };
  delete result.source_payload_ref;
  delete result.sourcePayloadRef;
  delete result.payload_ref;
  delete result.raw_payload_ref;
  delete result.source_snapshot_ref;
  delete result.payload_digest;
  delete result.source_payload_digest;
  delete result.raw_payload_digest;
  return result;
}

function isNativeSyncProvider(
  provider: integrationsLib.IntegrationProviderName,
): provider is NativeSyncProvider {
  return integrationsLib.isNativeProviderId(provider);
}

function isAuthOrAccessFailure(message: string): boolean {
  if (message.includes('github_rate_limited') || message.includes('provider_rate_limited')) {
    return false;
  }
  return (
    /\b(?:401|403|404)\b/.test(message) ||
    /\b(?:reconnect|expired|unauthorized|forbidden)\b/i.test(message)
  );
}

function syncPartialFailures(
  result?: integrationsLib.SyncResult,
): integrationsLib.SyncPartialFailure[] {
  if (!result || !Array.isArray(result.partialFailures)) return [];
  return result.partialFailures.filter(
    (failure) => typeof failure.error === 'string' && failure.error.length > 0,
  );
}

function summarizeSyncPartialFailures(failures: integrationsLib.SyncPartialFailure[]): string {
  return failures
    .map((failure) => {
      const location = [failure.resource, failure.surface, failure.area]
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join(':');
      return `${location || 'resource'} (${failure.error})`;
    })
    .join('; ')
    .slice(0, 500);
}

function isAuthOrAccessPartialFailure(failure: integrationsLib.SyncPartialFailure): boolean {
  return isAuthOrAccessFailure(summarizeSyncPartialFailures([failure]));
}

function providerRateLimitPause(err: unknown): {
  retryAt: Date;
  message: string;
  reason: string;
  provider?: NativeSyncProvider;
  scope?: string;
  externalAccountId?: string;
} | null {
  const isProviderRateLimit =
    integrationsLib.isProviderRateLimitError(err) ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'github_rate_limited');
  if (!isProviderRateLimit) {
    return null;
  }
  const retryAtValue = (err as { retryAt?: unknown }).retryAt;
  const retryAt =
    retryAtValue instanceof Date
      ? retryAtValue
      : typeof retryAtValue === 'string'
        ? new Date(retryAtValue)
        : null;
  if (!retryAt || Number.isNaN(retryAt.getTime())) return null;
  const record = err as {
    code?: unknown;
    provider?: unknown;
    rateLimitKind?: unknown;
    reason?: unknown;
    scope?: unknown;
    externalAccountId?: unknown;
  };
  const reason =
    typeof record.reason === 'string'
      ? record.reason
      : typeof record.code === 'string'
        ? record.code
        : 'provider_rate_limited';
  const provider =
    typeof record.provider === 'string' && record.provider !== 'mcp'
      ? (record.provider as NativeSyncProvider)
      : typeof record.code === 'string' && record.code === 'github_rate_limited'
        ? 'github'
        : undefined;
  const scope =
    typeof record.scope === 'string'
      ? record.scope
      : typeof record.rateLimitKind === 'string'
        ? record.rateLimitKind
        : undefined;
  return {
    retryAt,
    reason,
    message: err instanceof Error ? err.message : reason,
    ...(provider ? { provider } : {}),
    ...(scope ? { scope } : {}),
    ...(typeof record.externalAccountId === 'string' && record.externalAccountId.length > 0
      ? { externalAccountId: record.externalAccountId }
      : {}),
  };
}

function providerBudgetKey(
  integration: integrationsLib.IntegrationRow,
  scope: string,
  externalAccountId?: string,
): integrationsLib.ProviderBudgetKey | null {
  return integrationsLib.providerBudgetKeyForIntegration(integration, scope, externalAccountId);
}

function missingRequiredScopeSummary(
  provider: NativeSyncProvider,
  missingScopes: string[],
): string {
  return `${provider} connection is missing required OAuth scopes (${missingScopes.join(
    ', ',
  )}); reconnect to enable webhook provisioning and account-scoped provider budgets.`;
}

async function loadFirstProviderBudgetPause(
  db: Db,
  integration: integrationsLib.IntegrationRow,
  tokens: Record<string, unknown> | null,
): Promise<{ retryAt: Date; reason: string; scope: string } | null> {
  if (!isNativeSyncProvider(integration.provider)) return null;
  for (const scope of integrationsLib.providerSyncPolicy(integration.provider).budgetScopes) {
    const budgetKeys = integrationsLib.providerBudgetKeysForIntegration(integration, scope, tokens);
    for (const budgetKey of budgetKeys) {
      const pause = await integrationsLib.adminLoadProviderBudgetPause(db, budgetKey);
      if (pause) return pause;
    }
  }
  return null;
}

export async function runOneIntegration(
  db: Db,
  integrationId: string,
  kind: 'backfill' | 'incremental' | 'targeted',
  target?: TargetedIntegrationSyncJob,
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
    if (isProviderPaginationContinuation(target)) {
      const attempt = target.continuationAttempt ?? 0;
      if (attempt < MAX_PAGINATION_LOCK_RETRY_ATTEMPTS) {
        try {
          await queue.enqueueIntegrationSyncJob(
            { ...target, continuationAttempt: attempt + 1 },
            { delayMs: PAGINATION_LOCK_RETRY_DELAY_MS },
          );
        } catch (err) {
          log.warn(
            { err, integrationId, target },
            'failed to requeue blocked provider pagination continuation',
          );
        }
      } else {
        log.warn(
          { integrationId, target, attempt },
          'provider pagination continuation exhausted lock-contention retries',
        );
      }
    }
    return;
  }
  const continuationJobs: { data: TargetedIntegrationSyncJob; delayMs?: number }[] = [];
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
    const missingRequiredScopes = integrationsLib.missingRequiredProviderScopes(
      integration.provider,
      integration.scopes,
    );
    if (missingRequiredScopes.length > 0) {
      const summary = missingRequiredScopeSummary(integration.provider, missingRequiredScopes);
      await integrationsLib.adminRecordAudit(
        db,
        integration.teamId,
        'sync_degraded:missing_provider_scopes',
        {
          provider: integration.provider,
          missingScopes: missingRequiredScopes,
        },
        { integrationId },
      );
      await integrationsLib.adminRecordConnectionAttention(db, integration.teamId, {
        providerConnectionId: integration.providerConnectionId,
        integrationId,
        category: 'needs_reconnect',
        summary,
      });
    }
    if (integration.connectedByUserId) {
      const ownerStillMember = await integrationsLib.adminVerifyTeamMember(
        db,
        integration.teamId,
        integration.connectedByUserId,
      );
      if (!ownerStillMember) {
        const msg = 'Connection owner left team — choose a replacement connection';
        await integrationsLib.adminRecordError(db, integrationId, msg);
        await integrationsLib.adminRecordConnectionAttention(db, integration.teamId, {
          providerConnectionId: integration.providerConnectionId,
          integrationId,
          category: 'needs_new_owner',
          summary: msg,
        });
        return;
      }
    }
    const tokens = await integrationsLib.adminDecryptIntegrationTokens(db, integration);
    if (!tokens) {
      const msg = 'No tokens — reconnect required';
      await integrationsLib.adminRecordError(db, integrationId, msg);
      await integrationsLib.adminRecordConnectionAttention(db, integration.teamId, {
        providerConnectionId: integration.providerConnectionId,
        integrationId,
        category: 'needs_reconnect',
        summary: msg,
      });
      return;
    }
    const pause = await integrationsLib.adminLoadIntegrationSyncPause(db, integrationId);
    if (pause) {
      log.info({ integrationId, kind, retryAt: pause.retryAt }, 'integration sync paused');
      await integrationsLib.adminRecordAudit(
        db,
        integration.teamId,
        `sync_skipped:${kind}`,
        {
          provider: integration.provider,
          reason: pause.reason,
          retryAt: pause.retryAt.toISOString(),
        },
        { integrationId },
      );
      const pauseDelayMs = delayUntil(pause.retryAt);
      if (isProviderPaginationContinuation(target)) {
        continuationJobs.push({
          data: target,
          ...(pauseDelayMs ? { delayMs: pauseDelayMs } : {}),
        });
      }
      return;
    }
    const providerBudgetPause = await loadFirstProviderBudgetPause(db, integration, tokens);
    if (providerBudgetPause) {
      log.info(
        { integrationId, kind, retryAt: providerBudgetPause.retryAt },
        'integration provider budget paused',
      );
      await integrationsLib.adminRecordAudit(
        db,
        integration.teamId,
        `sync_skipped:${kind}`,
        {
          provider: integration.provider,
          reason: providerBudgetPause.reason,
          scope: providerBudgetPause.scope,
          retryAt: providerBudgetPause.retryAt.toISOString(),
        },
        { integrationId },
      );
      const providerBudgetPauseDelayMs = delayUntil(providerBudgetPause.retryAt);
      if (isProviderPaginationContinuation(target)) {
        continuationJobs.push({
          data: target,
          ...(providerBudgetPauseDelayMs ? { delayMs: providerBudgetPauseDelayMs } : {}),
        });
      }
      return;
    }
    const provider = integrationsLib.getProvider(integration.provider);
    const allSelections = await integrationsLib.adminListSelections(db, integrationId);
    const selections =
      kind === 'targeted' && target
        ? targetedSelections(integration.provider, allSelections, target)
        : allSelections;
    if (kind === 'targeted' && selections.length === 0) {
      await integrationsLib.adminRecordAudit(
        db,
        integration.teamId,
        'sync_skipped:targeted',
        {
          provider: integration.provider,
          resourceType: target?.resourceType,
          externalId: target?.externalId,
          reason: 'resource_not_selected',
        },
        { integrationId },
      );
      return;
    }

    // Document harvest is opt-in per provider and requires the integration
    // to have a connected user we can attribute uploads to. For
    // headless / system integrations (no connectedByUserId) we skip the
    // hook entirely — the integration_event row still lands.
    const harvestableUserId = integration.connectedByUserId;
    // Verify the connector is still a team member before mounting the
    // harvest hook. If they've left, withTeam would throw on
    // createDocument / addDocumentVersion and abort the whole sync —
    // not just harvest. Dropping the hook keeps integration_event
    // writes flowing; only document-body harvest pauses until an admin
    // reconnects under a current member's identity.
    const harvestUserStillMember =
      harvestableUserId !== null
        ? await integrationsLib.adminVerifyTeamMember(db, integration.teamId, harvestableUserId)
        : false;
    const providerSupportsDocumentHarvest =
      integration.provider === 'google_drive' || integration.provider === 'monday';
    if (providerSupportsDocumentHarvest && harvestableUserId !== null && !harvestUserStillMember) {
      await integrationsLib.adminRecordAudit(
        db,
        integration.teamId,
        'harvest_skipped_connector_left',
        { connectedByUserId: harvestableUserId },
        { integrationId },
      );
    }
    const harvestEnabled =
      providerSupportsDocumentHarvest && harvestableUserId !== null && harvestUserStillMember;

    const ctx: integrationsLib.SyncContext = {
      async writeEvents(events) {
        return integrationsLib.writeIntegrationEvents({ db, integration, events });
      },
      async recordAudit(auditKind, payload) {
        await integrationsLib.adminRecordAudit(db, integration.teamId, auditKind, payload, {
          integrationId,
        });
      },
      async saveCursor(resourceType, cursor, status) {
        await integrationsLib.adminSaveCursor(db, integrationId, resourceType, cursor, status);
      },
      async loadCursor(resourceType) {
        return integrationsLib.adminLoadCursor(db, integrationId, resourceType);
      },
      async persistTokens(tokens) {
        // Provider refreshed an access token in-memory (Drive
        // `ensureAccessToken`, Linear refresh path). Write the new
        // ciphertext back so the next sync starts from current state
        // rather than re-refreshing every tick. AES-256-GCM at rest.
        await integrationsLib.adminPersistTokens(db, integrationId, tokens);
      },
      ...(harvestEnabled && harvestableUserId
        ? {
            async harvestDocument(input) {
              return harvestIntegrationDocument({
                db,
                integration,
                harvestUserId: harvestableUserId,
                document: input,
              });
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
      let syncResult: integrationsLib.SyncResult | undefined;
      if (kind === 'backfill') {
        syncResult = await provider.backfill({ integration, tokens, selections, ctx });
      } else {
        syncResult = await provider.incrementalSync({
          integration,
          tokens,
          selections,
          ctx,
          ...(kind === 'targeted' && target
            ? {
                target: {
                  resourceType: target.resourceType,
                  externalId: target.externalId,
                  ...(target.surface ? { surface: target.surface } : {}),
                  ...(target.reason ? { reason: target.reason } : {}),
                  ...(target.triggeredBy ? { triggeredBy: target.triggeredBy } : {}),
                },
              }
            : {}),
        });
      }
      const partialFailures = syncPartialFailures(syncResult);
      const partialSummary =
        partialFailures.length > 0 ? summarizeSyncPartialFailures(partialFailures) : null;
      await integrationsLib.adminMarkSynced(db, integrationId);
      if (partialSummary) {
        const authPartialFailures = partialFailures.filter(isAuthOrAccessPartialFailure);
        const transientPartialFailures = partialFailures.filter(
          (failure) => !isAuthOrAccessPartialFailure(failure),
        );
        const authSummary =
          authPartialFailures.length > 0 ? summarizeSyncPartialFailures(authPartialFailures) : null;
        const transientSummary =
          transientPartialFailures.length > 0
            ? summarizeSyncPartialFailures(transientPartialFailures)
            : null;
        await integrationsLib.adminRecordError(db, integrationId, partialSummary);
        if (authSummary) {
          await integrationsLib.adminRecordConnectionAttention(db, integration.teamId, {
            providerConnectionId: integration.providerConnectionId,
            integrationId,
            category: 'needs_reconnect',
            summary: authSummary,
          });
        }
        if (transientSummary) {
          const transient = await integrationsLib.adminRecordTransientSyncFailure(
            db,
            integrationId,
            transientSummary,
          );
          if (transient.shouldCreateAttention) {
            await integrationsLib.adminRecordConnectionAttention(db, integration.teamId, {
              providerConnectionId: integration.providerConnectionId,
              integrationId,
              category: 'sync_error',
              summary: transientSummary,
            });
          }
        }
      } else {
        await integrationsLib.adminResetTransientSyncFailures(db, integrationId);
        await integrationsLib.adminResolveConnectionAttention(db, integration.teamId, {
          providerConnectionId: integration.providerConnectionId,
          integrationId,
          categories:
            missingRequiredScopes.length > 0 ? ['sync_error'] : ['needs_reconnect', 'sync_error'],
        });
      }
      for (const continuation of syncResult?.continuations ?? []) {
        const continuationDelayMs = continuation.retryAt
          ? delayUntil(continuation.retryAt)
          : undefined;
        continuationJobs.push({
          data: {
            kind: 'targeted',
            integrationId,
            teamId: integration.teamId,
            triggeredBy: 'reconcile',
            resourceType: continuation.resourceType,
            externalId: continuation.externalId,
            ...(continuation.surface ? { surface: continuation.surface } : {}),
            reason: 'provider_pagination_continuation',
          },
          ...(continuationDelayMs ? { delayMs: continuationDelayMs } : {}),
        });
      }
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
      const rateLimit = providerRateLimitPause(err);
      if (rateLimit) {
        await integrationsLib.adminRecordIntegrationSyncPause(db, integrationId, {
          retryAt: rateLimit.retryAt,
          reason: rateLimit.reason,
          error: rateLimit.message.slice(0, 500),
        });
        const rateLimitBudgetKey = providerBudgetKey(
          integration,
          rateLimit.scope ?? rateLimit.reason,
          rateLimit.externalAccountId,
        );
        if (rateLimitBudgetKey) {
          await integrationsLib.adminRecordProviderBudgetPause(db, rateLimitBudgetKey, {
            pausedUntil: rateLimit.retryAt,
            reason: rateLimit.reason,
            resetAt: rateLimit.retryAt,
          });
        }
        await integrationsLib.adminRecordAudit(
          db,
          integration.teamId,
          `sync_paused:${kind}`,
          {
            provider: integration.provider,
            reason: rateLimit.reason,
            ...(rateLimit.scope ? { scope: rateLimit.scope } : {}),
            retryAt: rateLimit.retryAt.toISOString(),
          },
          { integrationId },
        );
        const continuation =
          integrationsLib.syncContinuationFromError(err) ??
          (isProviderPaginationContinuation(target)
            ? {
                resourceType: target.resourceType,
                externalId: target.externalId,
                ...(target.surface ? { surface: target.surface } : {}),
              }
            : null);
        if (continuation) {
          const continuationDelayMs = delayUntil(rateLimit.retryAt);
          continuationJobs.push({
            data: {
              kind: 'targeted',
              integrationId,
              teamId: integration.teamId,
              triggeredBy: 'reconcile',
              resourceType: continuation.resourceType,
              externalId: continuation.externalId,
              ...(continuation.surface ? { surface: continuation.surface } : {}),
              reason: 'provider_pagination_continuation',
            },
            ...(continuationDelayMs ? { delayMs: continuationDelayMs } : {}),
          });
        }
        return;
      }
      if (isAuthOrAccessFailure(msg)) {
        await integrationsLib.adminRecordConnectionAttention(db, integration.teamId, {
          providerConnectionId: integration.providerConnectionId,
          integrationId,
          category: 'needs_reconnect',
          summary: msg.slice(0, 500),
        });
      } else {
        const transient = await integrationsLib.adminRecordTransientSyncFailure(
          db,
          integrationId,
          msg.slice(0, 500),
        );
        if (transient.shouldCreateAttention) {
          await integrationsLib.adminRecordConnectionAttention(db, integration.teamId, {
            providerConnectionId: integration.providerConnectionId,
            integrationId,
            category: 'sync_error',
            summary: msg.slice(0, 500),
          });
        }
      }
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
    for (const continuationJob of continuationJobs) {
      try {
        if (continuationJob.delayMs) {
          await queue.enqueueIntegrationSyncJob(continuationJob.data, {
            delayMs: continuationJob.delayMs,
          });
        } else {
          await queue.enqueueIntegrationSyncJob(continuationJob.data);
        }
      } catch (err) {
        log.warn(
          { err, integrationId, continuationJob },
          'failed to enqueue provider pagination continuation',
        );
      }
    }
  }
}

function targetedSelections(
  provider: NativeSyncProvider,
  selections: { kind: string; externalId: string }[],
  target: TargetedIntegrationSyncJob,
): { kind: string; externalId: string }[] {
  const exact = selections.filter(
    (selection) =>
      selection.kind === target.resourceType && selection.externalId === target.externalId,
  );
  if (exact.length > 0) return exact;

  if (provider === 'github' && target.resourceType === 'github.repo') {
    const owner = target.externalId.split('/')[0];
    if (
      owner &&
      selections.some(
        (selection) => selection.kind === 'github.org' && selection.externalId === owner,
      )
    ) {
      return [{ kind: 'github.repo', externalId: target.externalId }];
    }
  }

  if (provider === 'sentry' && target.resourceType === 'sentry.project') {
    const [orgSlug, projectSlug] = target.externalId.split('/');
    if (
      orgSlug &&
      projectSlug &&
      selections.some(
        (selection) => selection.kind === 'sentry.org' && selection.externalId === orgSlug,
      )
    ) {
      return [{ kind: 'sentry.project', externalId: target.externalId }];
    }
  }

  if (provider === 'monday' && target.resourceType === 'monday.item') {
    const [boardId, itemId] = target.externalId.split(':');
    if (
      boardId &&
      itemId &&
      selections.some(
        (selection) => selection.kind === 'monday.board' && selection.externalId === boardId,
      )
    ) {
      return [{ kind: 'monday.board', externalId: boardId }];
    }
  }

  return [];
}

function reconciliationDue(
  integration: {
    provider: NativeSyncProvider;
    lastSyncedAt?: Date | string | null;
  },
  now = Date.now(),
): boolean {
  const policy = integrationsLib.providerSyncPolicy(integration.provider);
  if (!integration.lastSyncedAt) return true;
  const lastSyncedAt =
    integration.lastSyncedAt instanceof Date
      ? integration.lastSyncedAt
      : new Date(integration.lastSyncedAt);
  if (Number.isNaN(lastSyncedAt.getTime())) return true;
  return now - lastSyncedAt.getTime() >= policy.reconciliationIntervalMs;
}

export async function handleTick(db: Db): Promise<void> {
  try {
    const webhookSubscriptions =
      await integrationsLib.adminReconcileExpiringWebhookSubscriptions(db);
    if (webhookSubscriptions.checked > 0) {
      log.info(webhookSubscriptions, 'integration webhook subscription renewal sweep complete');
    }
  } catch (err) {
    log.warn({ err }, 'integration webhook subscription renewal sweep failed');
    captureWorkerException(err, {
      component: 'worker_handoff',
      queueName: queue.QUEUE_NAMES.integrationSync,
      operation: 'reconcile_expiring_webhook_subscriptions',
    });
  }

  const all = await integrationsLib.adminListEnabledIntegrations(db);
  for (const i of all) {
    if (!isNativeSyncProvider(i.provider)) continue;
    const provider = i.provider;
    const pause = await integrationsLib.adminLoadIntegrationSyncPause(db, i.id);
    if (pause) {
      log.info(
        { integrationId: i.id, provider, retryAt: pause.retryAt },
        'integration sync paused — not enqueueing tick',
      );
      continue;
    }
    const providerBudgetPause = await loadFirstProviderBudgetPause(db, i, null);
    if (providerBudgetPause) {
      log.info(
        {
          integrationId: i.id,
          provider,
          retryAt: providerBudgetPause.retryAt,
          scope: providerBudgetPause.scope,
        },
        'integration provider budget paused — not enqueueing tick',
      );
      continue;
    }
    if (!reconciliationDue({ provider, lastSyncedAt: i.lastSyncedAt })) {
      log.debug(
        { integrationId: i.id, provider, lastSyncedAt: i.lastSyncedAt },
        'integration reconciliation not due yet',
      );
      continue;
    }
    try {
      await queue.enqueueIntegrationSyncJob({
        kind: 'incremental',
        integrationId: i.id,
        teamId: i.teamId,
        triggeredBy: 'reconcile',
      });
    } catch (err) {
      log.warn({ err, integrationId: i.id }, 'failed to enqueue per-integration tick');
      captureWorkerException(err, {
        component: 'worker_handoff',
        queueName: queue.QUEUE_NAMES.integrationSync,
        operation: 'enqueue_incremental_sync_tick',
      });
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
      await runOneIntegration(
        deps.db,
        data.integrationId,
        data.kind,
        data.kind === 'targeted' ? data : undefined,
      );
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
    captureWorkerJobFailure(err, job);
  });
  return worker;
}
