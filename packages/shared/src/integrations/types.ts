import type { TimelineEventClass } from '#src/event-class.js';
import type {
  integrations as integrationsTable,
  providerConnections as providerConnectionsTable,
} from '@timeline/db';

// Phase 11 — Provider adapter interface.
//
// Every integration (Google Drive, Linear, GitHub, Monday.com, Slack, Sentry,
// custom MCP-backed)
// implements this. The shared worker + API routes drive providers through
// this surface so business logic stays out of route handlers and webhooks.

export type IntegrationRow = typeof integrationsTable.$inferSelect;
export type ProviderConnectionRow = typeof providerConnectionsTable.$inferSelect;

/**
 * Workspace object mapping hint. When a provider sets this on an
 * IntegrationEvent, the event-writer treats it as reconciliation evidence:
 * artifact anchors, source refs, association/output payloads, and optional
 * links to preexisting provider-mapped entities. It does not create or rewrite
 * workspace object rows.
 */
export interface ObjectMapping {
  type:
    | 'person'
    | 'company'
    | 'project'
    | 'topic'
    | 'other'
    | 'deal'
    | 'vendor'
    | 'incident'
    | 'document'
    | 'decision'
    | 'hiring_loop'
    | 'task'
    | 'follow_up';
  canonicalName: string;
  /** Provider-scoped stable id used for artifact anchors and compatibility links. */
  externalId: string;
  /**
   * Human-facing title for UI surfaces when canonicalName carries provider identity.
   * Providers should keep stable external identity in canonicalName/externalId and
   * put the shorter user-facing label here.
   */
  displayTitle?: string;
  status?: 'open' | 'todo' | 'in_progress' | 'done' | 'cancelled' | 'suggested' | 'follow_up';
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
  url?: string;
  /** Optional aliases (e.g. ENG-42 for a Linear issue). */
  aliases?: string[];
  /** Optional provider metadata to include in evidence/output payloads. */
  metadata?: Record<string, unknown>;
}

/**
 * Normalized event written into raw_events by the event-writer. The
 * dedup_key drives the per-team partial unique index that makes
 * webhook replay / backfill rerun a no-op.
 */
export interface IntegrationEvent {
  /** Stable provider-scoped dedup key, e.g. `linear:issue:ABC-123:updated:1716000000`. */
  dedupKey: string;
  provider: string;
  externalObjectId: string;
  externalEventId?: string | null;
  eventType: string;
  occurredAt: Date;
  actor?: { externalId?: string; name?: string; email?: string } | null;
  contentText: string;
  visibility?: 'team' | 'private' | 'specific_users';
  visibilityUserIds?: string[] | null;
  /**
   * Extra provider-specific fields merged into source_metadata. Providers should
   * pass `source_payload_ref` and `payload_digest` when they persisted a raw
   * provider payload elsewhere. If omitted, the event-writer stores a compact
   * inline snapshot of this normalized IntegrationEvent so reconciliation replay
   * still has a stable source payload ref.
   */
  extra?: Record<string, unknown>;
  /**
   * Optional presentation family. When omitted, the event-writer classifies
   * from provider, event type, and nested record kind. Pulses never promote
   * `objectMap` into artifact identity.
   */
  eventClass?: TimelineEventClass;
  /**
   * A durable Monday update/reply deletion target. The writer persists it
   * before writing the event batch, hides matching immutable source rows, and
   * applies it to future late/stale conversation writes in this integration.
   */
  sourceTombstone?: {
    kind: 'monday_conversation';
    updateId: string;
    replyId?: string | null;
    reason: string;
  };
  /** Phase 11: optional workspace object mapping. */
  objectMap?: ObjectMapping;
}

export interface HarvestDocumentInput {
  /** Filename including extension. */
  filename: string;
  contentType: string;
  body: Buffer;
  /** Provider-side stable id (Drive fileId) — drives idempotency. */
  externalId: string;
  /** Optional metadata stored on the document row for citations. */
  metadata?: Record<string, unknown>;
}

export interface SyncContext {
  /**
   * Persist a batch of events. Idempotent — duplicate dedup_keys are
   * silently skipped. Returns the ids of the newly inserted raw_events
   * rows (skipped duplicates not included).
   */
  writeEvents(events: IntegrationEvent[]): Promise<string[]>;
  /** Provider may emit progress notes into the audit log mid-sync. */
  recordAudit(kind: string, payload: Record<string, unknown>): Promise<void>;
  /** Update the per-resource cursor after a successful page or surface-specific failure. */
  saveCursor(
    resourceType: string,
    cursor: unknown,
    status?: { lastStatus?: string; lastError?: string | null },
  ): Promise<void>;
  /**
   * Record a cursor and the exact continuation(s) needed to resume it for the
   * worker's final durable checkpoint transaction. Providers with
   * expiring/provider-page cursors must use this rather than saveCursor()
   * when a continuation is required.
   *
   * It remains optional only for isolated provider tests and non-worker
   * callers that do not persist cursors. The integration worker always
   * supplies it.
   */
  saveCursorWithContinuations?(
    resourceType: string,
    cursor: unknown,
    continuations: SyncContinuation[],
    status?: { lastStatus?: string; lastError?: string | null },
  ): Promise<void>;
  /** Load the last persisted cursor for a resource. Returns `{}` when unset. */
  loadCursor(resourceType: string): Promise<unknown>;
  /**
   * Phase 11 — Drive body harvest. Optional: providers that have file
   * bodies (Drive) can call this to route a file into the team document
   * drive (Phase 9 pipeline: createDocument → S3 put → finalize → extract
   * → embed). Idempotent on externalId — re-harvesting the same file
   * updates the existing document by adding a new version.
   */
  harvestDocument?(input: HarvestDocumentInput): Promise<{ documentId: string; versionId: string }>;
  /**
   * Persist refreshed OAuth tokens back to the integration row. Providers
   * call this after `ensureAccessToken` (or the equivalent refresh path)
   * returns a token blob distinct from the input — without this, the
   * worker keeps the old ciphertext and every sync repeats the refresh.
   * The worker writes via `adminPersistTokens` (AES-256-GCM at rest).
   */
  persistTokens(tokens: Record<string, unknown>): Promise<void>;
}

export interface SyncPartialFailure {
  resource: string;
  surface?: string;
  area?: string;
  error: string;
}

export interface SyncContinuation {
  resourceType: string;
  externalId: string;
  surface?: string;
  /** Earliest safe time to resume a durable provider checkpoint. */
  retryAt?: Date;
  /** Bounded worker-local retry count for an integration advisory-lock miss. */
  continuationAttempt?: number;
}

export interface SyncResult {
  partialFailures?: SyncPartialFailure[];
  /** Provider resources that must be resumed promptly before their page cursor expires. */
  continuations?: SyncContinuation[];
}

export interface SyncTarget {
  resourceType: string;
  externalId: string;
  surface?: string;
  reason?: string;
  triggeredBy?: string;
}

export type NativeProviderId = IntegrationProvider['id'];

export const NATIVE_PROVIDER_IDS = [
  'google_drive',
  'linear',
  'github',
  'monday',
  'slack',
  'sentry',
] as const satisfies readonly NativeProviderId[];

export function isNativeProviderId(provider: string): provider is NativeProviderId {
  return (NATIVE_PROVIDER_IDS as readonly string[]).includes(provider);
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export interface ProviderSyncPolicy {
  reconciliationIntervalMs: number;
  ingestionPosture: 'webhook_first' | 'webhook_wakeup' | 'reconciliation_first';
  budgetScopes: readonly string[];
  supportsWebhookIngress: boolean;
  supportsTargetedSync: boolean;
  provisioningModel: 'app_level' | 'provider_managed' | 'manual' | 'none';
}

export const PROVIDER_SYNC_POLICIES: Record<NativeProviderId, ProviderSyncPolicy> = {
  google_drive: {
    reconciliationIntervalMs: 15 * MINUTE_MS,
    ingestionPosture: 'webhook_wakeup',
    budgetScopes: ['requests'],
    supportsWebhookIngress: true,
    supportsTargetedSync: false,
    provisioningModel: 'manual',
  },
  linear: {
    reconciliationIntervalMs: 6 * HOUR_MS,
    ingestionPosture: 'webhook_first',
    budgetScopes: ['requests'],
    supportsWebhookIngress: true,
    supportsTargetedSync: false,
    provisioningModel: 'manual',
  },
  github: {
    reconciliationIntervalMs: 6 * HOUR_MS,
    ingestionPosture: 'webhook_first',
    budgetScopes: ['requests', 'primary', 'secondary'],
    supportsWebhookIngress: true,
    supportsTargetedSync: true,
    provisioningModel: 'app_level',
  },
  monday: {
    reconciliationIntervalMs: HOUR_MS,
    ingestionPosture: 'webhook_first',
    budgetScopes: ['requests', 'daily', 'minute', 'complexity', 'concurrency'],
    supportsWebhookIngress: true,
    supportsTargetedSync: true,
    provisioningModel: 'provider_managed',
  },
  slack: {
    reconciliationIntervalMs: HOUR_MS,
    ingestionPosture: 'reconciliation_first',
    budgetScopes: ['requests', 'web_api'],
    supportsWebhookIngress: false,
    supportsTargetedSync: false,
    provisioningModel: 'none',
  },
  sentry: {
    reconciliationIntervalMs: 24 * HOUR_MS,
    ingestionPosture: 'webhook_first',
    budgetScopes: ['requests'],
    supportsWebhookIngress: true,
    supportsTargetedSync: true,
    provisioningModel: 'manual',
  },
};

export function providerSyncPolicy(provider: NativeProviderId): ProviderSyncPolicy {
  return PROVIDER_SYNC_POLICIES[provider];
}

const REQUIRED_PROVIDER_SCOPES: Partial<Record<NativeProviderId, readonly string[]>> = {
  monday: ['account:read', 'webhooks:read', 'webhooks:write'],
};

export function missingRequiredProviderScopes(
  provider: NativeProviderId,
  scopes: readonly string[] | null | undefined,
): string[] {
  const required = REQUIRED_PROVIDER_SCOPES[provider] ?? [];
  if (required.length === 0) return [];
  const granted = new Set(scopes ?? []);
  return required.filter((scope) => !granted.has(scope));
}

export const PROVIDER_RATE_LIMIT_CODE = 'provider_rate_limited';

export class ProviderRateLimitError extends Error {
  readonly code: string = PROVIDER_RATE_LIMIT_CODE;
  readonly provider: NativeProviderId;
  readonly retryAt: Date;
  readonly retryAfterSeconds: number;
  readonly scope: string;
  readonly reason: string;
  readonly externalAccountId?: string;

  constructor(input: {
    provider: NativeProviderId;
    retryAt: Date;
    retryAfterSeconds: number;
    scope: string;
    reason: string;
    message?: string;
    externalAccountId?: string;
  }) {
    super(
      input.message ??
        `${PROVIDER_RATE_LIMIT_CODE}: ${input.provider} ${input.scope} limited; retry after ${input.retryAt.toISOString()}`,
    );
    this.name = 'ProviderRateLimitError';
    this.provider = input.provider;
    this.retryAt = input.retryAt;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.scope = input.scope;
    this.reason = input.reason;
    if (input.externalAccountId) this.externalAccountId = input.externalAccountId;
  }
}

interface SyncContinuationCarrier {
  syncContinuation?: SyncContinuation;
  syncContinuations?: SyncContinuation[];
}

function validSyncContinuation(value: unknown): SyncContinuation | null {
  if (typeof value !== 'object' || value === null) return null;
  const continuation = value as Partial<SyncContinuation>;
  if (
    typeof continuation.resourceType !== 'string' ||
    continuation.resourceType.length === 0 ||
    typeof continuation.externalId !== 'string' ||
    continuation.externalId.length === 0
  ) {
    return null;
  }
  return {
    resourceType: continuation.resourceType,
    externalId: continuation.externalId,
    ...(typeof continuation.surface === 'string' && continuation.surface.length > 0
      ? { surface: continuation.surface }
      : {}),
    ...(continuation.retryAt instanceof Date ? { retryAt: continuation.retryAt } : {}),
  };
}

function dedupeSyncContinuations(continuations: readonly SyncContinuation[]): SyncContinuation[] {
  const byTarget = new Map<string, SyncContinuation>();
  for (const continuation of continuations) {
    const key = [
      continuation.resourceType,
      continuation.externalId,
      continuation.surface ?? '',
    ].join('\u0000');
    if (!byTarget.has(key)) byTarget.set(key, continuation);
  }
  return [...byTarget.values()];
}

/**
 * Keep a resource checkpoint attached to a provider error so the worker can
 * resume exactly that resource once a provider pause expires.
 */
export function attachSyncContinuation<T extends Error>(
  err: T,
  continuation: SyncContinuation,
): T & SyncContinuationCarrier {
  const carried = syncContinuationsFromError(err);
  return Object.assign(err, {
    syncContinuation: continuation,
    syncContinuations: dedupeSyncContinuations([...carried, continuation]),
  });
}

/**
 * Retain every already-checkpointed resource when a later provider call throws.
 * The singular field remains for callers that can only resume one target.
 */
export function attachSyncContinuations<T extends Error>(
  err: T,
  continuations: readonly SyncContinuation[],
): T & SyncContinuationCarrier {
  const carried = syncContinuationsFromError(err);
  const all = dedupeSyncContinuations([...continuations, ...carried]);
  const singular =
    validSyncContinuation((err as SyncContinuationCarrier).syncContinuation) ?? all.at(-1);
  if (singular) {
    return Object.assign(err, {
      syncContinuation: singular,
      syncContinuations: all,
    });
  }
  return Object.assign(err, { syncContinuations: all });
}

export function syncContinuationsFromError(err: unknown): SyncContinuation[] {
  if (typeof err !== 'object' || err === null) return [];
  const carrier = err as SyncContinuationCarrier;
  const plural = Array.isArray(carrier.syncContinuations)
    ? carrier.syncContinuations
        .map(validSyncContinuation)
        .filter((value): value is SyncContinuation => value !== null)
    : [];
  const singular = validSyncContinuation(carrier.syncContinuation);
  return dedupeSyncContinuations([...plural, ...(singular ? [singular] : [])]);
}

export function syncContinuationFromError(err: unknown): SyncContinuation | null {
  if (typeof err !== 'object' || err === null) return null;
  return validSyncContinuation((err as SyncContinuationCarrier).syncContinuation);
}

export function isProviderRateLimitError(err: unknown): err is ProviderRateLimitError {
  if (err instanceof ProviderRateLimitError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const record = err as {
    provider?: unknown;
    retryAt?: unknown;
    retryAfterSeconds?: unknown;
    scope?: unknown;
    reason?: unknown;
  };
  return (
    typeof record.provider === 'string' &&
    (record.retryAt instanceof Date || typeof record.retryAt === 'string') &&
    typeof record.retryAfterSeconds === 'number' &&
    typeof record.scope === 'string' &&
    typeof record.reason === 'string'
  );
}

export function isProviderCooldownErrorMessage(error: string | null | undefined): boolean {
  if (!error) return false;
  const normalized = error.toLowerCase();
  return (
    normalized.includes('provider_rate_limited') ||
    normalized.includes('github_rate_limited') ||
    normalized.includes('monday_rate_limited') ||
    normalized.includes('slack_rate_limited') ||
    normalized.includes('daily_limit_exceeded') ||
    normalized.includes('api rate limit exceeded') ||
    normalized.includes('secondary rate limit') ||
    normalized.includes('retry after')
  );
}

export interface TargetedSyncTask {
  integrationId: string;
  teamId: string;
  triggeredBy: 'webhook' | 'reconcile' | 'manual';
  resourceType: string;
  externalId: string;
  surface?: string;
  reason?: string;
}

export interface WebhookVerifyInput {
  provider: NativeProviderId;
  headers: Headers;
  rawBody: string;
}

export type WebhookVerifyResult =
  | {
      ok: true;
      externalDeliveryId?: string | null;
      externalAccountId?: string | null;
      resourceKind?: string | null;
      externalResourceId?: string | null;
      eventType: string;
      action?: string | null;
      payload: unknown;
      dedupKey: string;
    }
  | {
      ok: false;
      reason: string;
      responseStatus?: number;
    };

export interface WebhookTargetInput {
  provider: NativeProviderId;
  verified: Extract<WebhookVerifyResult, { ok: true }>;
}

export interface WebhookTargetHint {
  externalAccountId?: string;
  resourceKind?: string;
  externalResourceId?: string;
  providerConnectionId?: string;
  integrationId?: string;
}

export interface WebhookNormalizeInput {
  deliveryId: string;
  targetId: string;
  integration: IntegrationRow;
  payload: unknown;
}

export interface WebhookNormalizeResult {
  events: IntegrationEvent[];
  syncTasks: TargetedSyncTask[];
  /** The provider fully handled this delivery and an empty task list is intentional. */
  syncTaskDisposition?: 'handled';
  ignoredReason?: string;
}

export type WebhookHandleResult = IntegrationEvent[] | WebhookNormalizeResult;

export interface WebhookProvisionInput {
  integration: IntegrationRow;
  tokens: unknown;
  selections: { kind: string; externalId: string }[];
  existingSubscriptions?: WebhookSubscription[];
  ctx?: WebhookProvisionContext;
}

export interface WebhookDeprovisionInput {
  integration: IntegrationRow;
  tokens: unknown;
  subscription: WebhookSubscription;
  ctx?: ListSyncableResourcesContext;
}

export interface WebhookSubscription {
  externalSubscriptionId?: string | null;
  resourceKind: string;
  externalResourceId: string;
  eventType: string;
  expiresAt?: Date | null;
}

export interface WebhookProvisionContext extends ListSyncableResourcesContext {
  /**
   * Persist a provider-side hook immediately after it is created. Provider
   * provisioning is not transactional with our database, so callers should use
   * this before creating the next hook to avoid leaking duplicate provider hooks
   * when a later create call fails.
   */
  persistWebhookSubscription(subscription: WebhookSubscription): Promise<void>;
}

export interface ReconcilePolicyInput {
  integration: IntegrationRow;
}

export interface ReconcilePolicy {
  intervalMs: number;
  staleAfterMs?: number;
  mode: 'webhook_first' | 'wake_up_first' | 'reconciliation_first';
}

export interface NativeWebhookAdapter {
  provider: NativeProviderId;
  verify(input: WebhookVerifyInput): Promise<WebhookVerifyResult>;
  resolveTargets(input: WebhookTargetInput): Promise<WebhookTargetHint[]>;
  normalize(input: WebhookNormalizeInput): Promise<WebhookNormalizeResult>;
  provision?(input: WebhookProvisionInput): Promise<WebhookSubscription[]>;
  deprovision?(input: WebhookDeprovisionInput): Promise<void>;
  reconcilePolicy(input: ReconcilePolicyInput): ReconcilePolicy;
}

export interface ProviderResource {
  /** External id (Drive folder id, Linear project id, GitHub repo full_name). */
  externalId: string;
  /** Human label rendered in the selection UI. */
  label: string;
  /** Provider-specific selection kind (e.g. `drive.folder`, `linear.project`, `github.repo`). */
  kind: string;
  /** Optional provider-specific terms that make the source picker searchable by user language. */
  searchText?: string;
}

export interface ListSyncableResourcesContext {
  /**
   * Persist refreshed OAuth tokens while listing picker resources. Without
   * this, a provider can successfully refresh for the list call but leave the
   * encrypted connection with the expired token.
   */
  persistTokens(tokens: Record<string, unknown>): Promise<void>;
}

export interface OAuthStartInput {
  teamId: string;
  userId: string;
  redirectUri: string;
  state: string;
}

export interface OAuthStartOutput {
  authorizeUrl: string;
}

export interface OAuthCallbackInput {
  code: string;
  redirectUri: string;
}

export interface OAuthCallbackOutput {
  /** Provider-issued account id (Google sub, Linear org id, GitHub installation id). */
  externalAccountId: string;
  displayName: string;
  scopes: string[];
  /** Token payload to encrypt and persist. Shape is provider-specific. */
  tokens: Record<string, unknown>;
  /** Optional expiry hint for the access token. */
  accessTokenExpiresAt?: Date;
}

export interface IntegrationProvider {
  id: 'google_drive' | 'linear' | 'github' | 'monday' | 'slack' | 'sentry';
  displayLabel: string;
  /**
   * Build the OAuth authorize URL. Returns the URL only — the route
   * handler is responsible for redirecting the browser. The `state`
   * field must be embedded verbatim so the callback can recover it.
   */
  startOAuth(input: OAuthStartInput): Promise<OAuthStartOutput>;
  /**
   * Exchange the OAuth code for tokens and a stable account
   * identifier. Throws on any error — the route handler converts that
   * into a user-visible failure message and an audit row.
   */
  handleOAuthCallback(input: OAuthCallbackInput): Promise<OAuthCallbackOutput>;
  /**
   * List the resources the user can pick to sync (folders, projects,
   * repos). Called by the settings UI after the OAuth handshake.
   */
  listSyncableResources(
    integration: IntegrationRow,
    tokens: unknown,
    ctx?: ListSyncableResourcesContext,
  ): Promise<ProviderResource[]>;
  /**
   * Full backfill of the chosen resources. Idempotent under the
   * dedup_key index. Must paginate internally and call
   * `ctx.saveCursor()` after each page so a crash resumes from the
   * right place.
   */
  backfill(input: {
    integration: IntegrationRow;
    tokens: unknown;
    selections: { kind: string; externalId: string }[];
    ctx: SyncContext;
  }): Promise<SyncResult | undefined>;
  /**
   * Delta sync since the last cursor. Same idempotency rules.
   */
  incrementalSync(input: {
    integration: IntegrationRow;
    tokens: unknown;
    selections: { kind: string; externalId: string }[];
    ctx: SyncContext;
    target?: SyncTarget;
  }): Promise<SyncResult | undefined>;
  /**
   * Normalize a verified webhook payload into IntegrationEvents. The
   * route handler is responsible for HMAC verification; this just
   * shapes the payload.
   */
  handleWebhook?(input: {
    integration: IntegrationRow;
    payload: unknown;
  }): Promise<WebhookHandleResult>;
  /**
   * Optional native webhook subscription management. Providers return the
   * active desired subscriptions after creating any missing provider-side
   * hooks. Shared scope code persists the returned rows and deprovisions stale
   * rows through `deprovisionWebhook`.
   */
  provisionWebhooks?(input: WebhookProvisionInput): Promise<WebhookSubscription[]>;
  deprovisionWebhook?(input: WebhookDeprovisionInput): Promise<void>;
}
