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
 * IntegrationEvent, the event-writer upserts a corresponding entities
 * row (idempotent by metadata->>'integration_external_id') so the
 * external object shows up on /app/objects with full timeline history.
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
  /** Provider-scoped stable id used as the dedup key for the entity row. */
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
  /** Optional provider metadata to merge onto the mapped entity row. */
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
  /** Extra provider-specific fields merged into source_metadata. */
  extra?: Record<string, unknown>;
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

export interface SyncResult {
  partialFailures?: SyncPartialFailure[];
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
  monday: ['account:read', 'webhooks:write'],
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
