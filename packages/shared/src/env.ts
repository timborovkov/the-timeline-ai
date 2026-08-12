import { z } from 'zod';

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanString(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return value as boolean;
}

function emptyStringAsUnset(value: unknown): unknown {
  return value === '' ? undefined : value;
}

function applyAuthAliases(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...raw,
    AUTH_SECRET: nonEmptyString(raw.AUTH_SECRET) ?? nonEmptyString(raw.NEXTAUTH_SECRET),
    AUTH_URL: nonEmptyString(raw.AUTH_URL) ?? nonEmptyString(raw.NEXTAUTH_URL),
  };
}

/**
 * Keys permitted non-empty on production `WORKER_MODE=document-extract`.
 * Enforced against raw `process.env` (not just parsed schema keys) so
 * undocumented secrets like `SLACK_CANARY_*` / `MCP_PREREGISTERED_*` cannot
 * hitch a ride on a copied Railway variable set (ADR 0013).
 */
const DOCUMENT_EXTRACT_PROCESS_ENV_ALLOWLIST = new Set([
  'NODE_ENV',
  'LOG_LEVEL',
  'WORKER_MODE',
  'DOCUMENT_EXTRACT_ENABLED',
  'DOCUMENT_EXTRACT_ALLOW_INPROCESS',
  'DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS',
  'DOCUMENT_EXTRACT_MAX_VISION_PAGES',
  'DAYTONA_API_KEY',
  'DAYTONA_API_URL',
  'DAYTONA_TARGET',
  'DAYTONA_SNAPSHOT',
  'DAYTONA_SNAPSHOT_ENSURE',
  'DATABASE_URL',
  'REDIS_URL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'S3_BUCKET_DOCUMENTS',
  // Crash reporting only — not SENTRY_AUTH_TOKEN (release upload).
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'SENTRY_TRACES_SAMPLE_RATE',
  'SENTRY_PROFILES_SAMPLE_RATE',
  'SENTRY_RELEASE',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
]);

/** Exact shell/runtime keys (not prefixes — avoid `LANG` matching `LANGSMITH_*`). */
const DOCUMENT_EXTRACT_PROCESS_ENV_EXACT_ALLOWLIST = new Set([
  '_',
  'PORT',
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'TZ',
  'HOSTNAME',
  'HOSTTYPE',
  'MACHTYPE',
  'OSTYPE',
  'SHLVL',
  'PWD',
  'OLDPWD',
  'COLORTERM',
  'CI',
  // Railpack's mise toolchain/runtime metadata. Keep these exact so a future
  // credential-bearing MISE_* or RAILPACK_* variable is still rejected.
  'MISE_DATA_DIR',
  'MISE_SHIMS_DIR',
  'MISE_CACHE_DIR',
  'MISE_CONFIG_DIR',
  'MISE_INSTALLS_DIR',
  'RAILPACK_VERSION',
  '__MISE_SHIM',
  '__MISE_DIFF',
]);

const DOCUMENT_EXTRACT_PROCESS_ENV_PREFIX_ALLOWLIST = [
  'LC_',
  'XDG_',
  'SSH_',
  'NODE_',
  'npm_',
  'NPM_',
  'PNPM_',
  'COREPACK_',
  'RAILWAY_',
  'NIX_',
  'SSL_CERT_',
  'OPENSSL_',
] as const;

/** Exported for unit tests. */
export function isAllowedDocumentExtractProcessEnvKey(key: string): boolean {
  if (DOCUMENT_EXTRACT_PROCESS_ENV_ALLOWLIST.has(key)) return true;
  if (DOCUMENT_EXTRACT_PROCESS_ENV_EXACT_ALLOWLIST.has(key)) return true;
  return DOCUMENT_EXTRACT_PROCESS_ENV_PREFIX_ALLOWLIST.some((prefix) => key.startsWith(prefix));
}

function assertDocumentExtractProcessEnvAllowlist(
  raw: NodeJS.ProcessEnv,
  ctx: z.RefinementCtx,
): void {
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === '') continue;
    if (isAllowedDocumentExtractProcessEnvKey(key)) continue;
    ctx.addIssue({
      code: 'custom',
      path: [key],
      message: `${key} must not be set on WORKER_MODE=document-extract (credential-thin extract service)`,
    });
  }
}

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  /**
   * Worker process role. `document-extract` boots only the document-extract
   * BullMQ consumer (credential-thin extract service). `full` boots the
   * normal worker set; pair with `DOCUMENT_EXTRACT_ENABLED=false` on the
   * main worker when a dedicated extract service owns that queue.
   */
  WORKER_MODE: z.enum(['full', 'document-extract']).default('full'),
  /**
   * When false, a `full` worker skips starting the document-extract consumer.
   * Ignored in `WORKER_MODE=document-extract` (that mode always starts it).
   */
  DOCUMENT_EXTRACT_ENABLED: z.preprocess(booleanString, z.boolean().default(true)),
  /**
   * Dev-only: allow in-process PDF/DOCX parsers when Daytona is unset.
   * Production extract mode must use Daytona sandboxes.
   */
  DOCUMENT_EXTRACT_ALLOW_INPROCESS: z.preprocess(booleanString, z.boolean().default(false)),
  // Daytona sandbox isolation for untrusted document parsers (ADR 0013).
  DAYTONA_API_KEY: z.string().optional(),
  DAYTONA_API_URL: z.preprocess(emptyStringAsUnset, z.url().default('https://app.daytona.io/api')),
  DAYTONA_TARGET: z.preprocess(emptyStringAsUnset, z.string().default('us')),
  /**
   * Daytona snapshot name for document-extract sandboxes.
   * Unset / `auto` / `content-hash` → `timeline-document-extract-<sandboxHash>`
   * (resolved in the worker; see ADR 0013).
   */
  DAYTONA_SNAPSHOT: z.preprocess(emptyStringAsUnset, z.string().optional()),
  /**
   * When true (default), extract-main ensures the named snapshot exists once
   * at boot (create-if-missing; never rebuilds an existing snapshot).
   */
  DAYTONA_SNAPSHOT_ENSURE: z.preprocess(booleanString, z.boolean().default(true)),
  /** Sparse-PDF text threshold (chars) before rendering pages for vision. */
  DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS: z.coerce.number().int().positive().default(500),
  /** Max pages rendered for sparse-PDF vision (hard-capped at 100 in code). */
  DOCUMENT_EXTRACT_MAX_VISION_PAGES: z.coerce.number().int().positive().default(20),

  // Auth — required for web + full worker; optional for document-extract mode.
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 chars').optional(),
  AUTH_URL: z.url().default('http://localhost:3000'),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),

  // Database
  DATABASE_URL: z.url(),

  // Redis (optional in Phase 1; required from Phase 3)
  REDIS_URL: z.url().optional(),

  // Qdrant (Phase 5+)
  QDRANT_URL: z.url().optional(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('events'),

  // S3 / RustFS (Phase 3+)
  S3_ENDPOINT: z.url().optional(),
  /**
   * Public HTTPS endpoint used when signing browser-facing PUT/GET URLs.
   * S3_ENDPOINT is typically Railway's private hostname (HTTP) which workers
   * use happily but the browser blocks as mixed content. Set this to a
   * publicly reachable HTTPS URL for the same RustFS instance. Falls back
   * to S3_ENDPOINT when unset (fine for local dev).
   *
   * `preprocess` so an empty value in .env (`S3_PUBLIC_ENDPOINT=`) is read
   * the same as "unset" — `.url()` would otherwise reject empty string and
   * crash startup for anyone who copied .env.example verbatim.
   */
  S3_PUBLIC_ENDPOINT: z.preprocess(emptyStringAsUnset, z.url().optional()),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().optional(),
  S3_BUCKET_AUDIO: z.string().optional(),
  S3_BUCKET_ATTACHMENTS: z.string().optional(),
  S3_BUCKET_EXPORTS: z.string().optional(),
  /**
   * Phase 9 — team document drive. Object keys are versioned and never
   * overwritten in place (see `documents/object-key.ts`), so this bucket
   * can have its own lifecycle policy distinct from `S3_BUCKET_ATTACHMENTS`.
   */
  S3_BUCKET_DOCUMENTS: z.string().optional(),

  // OpenRouter (Phase 3+)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.url().optional(),
  TASK_CATEGORY_CLASSIFICATION_ENABLED: z.preprocess(booleanString, z.boolean().default(false)),
  TASK_CATEGORY_AUTO_ENQUEUE_ENABLED: z.preprocess(booleanString, z.boolean().default(false)),
  TASK_CATEGORY_WORKER_ENABLED: z.preprocess(booleanString, z.boolean().default(false)),
  TASK_CATEGORY_BACKFILL_ENABLED: z.preprocess(booleanString, z.boolean().default(false)),
  TASK_CATEGORY_UI_ENABLED: z.preprocess(booleanString, z.boolean().default(false)),
  CROSS_SOURCE_EVIDENCE_MODE: z.enum(['off', 'shadow', 'enforced']).default('off'),
  E2E_DETERMINISTIC_EMBEDDINGS: z.preprocess(booleanString, z.boolean().default(false)),

  // LangSmith LLM observability (optional)
  LANGSMITH_TRACING: z.preprocess(booleanString, z.boolean().default(false)),
  LANGSMITH_TRACING_SAMPLING_RATE: z.preprocess(
    emptyStringAsUnset,
    z.coerce.number().min(0).max(1).optional(),
  ),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.preprocess(emptyStringAsUnset, z.string().optional()),
  LANGSMITH_ENDPOINT: z.preprocess(
    emptyStringAsUnset,
    z.url().default('https://api.smith.langchain.com'),
  ),
  LANGSMITH_WORKSPACE_ID: z.string().optional(),

  // Telegram (Phase 2+)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),

  // Postmark (Phase 7)
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  TRANSACTIONAL_EMAIL_FROM: z.string().optional(),
  INVITE_EMAIL_FROM: z.string().optional(),
  POSTMARK_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Public support/contact form destination. In production, support
   * submissions are sent through Postmark to this address. Leave unset in
   * local/dev environments where the public form should show a config error
   * instead of silently dropping messages.
   */
  SUPPORT_EMAIL: z.preprocess(emptyStringAsUnset, z.email().optional()),
  INBOUND_EMAIL_DOMAIN: z.string().optional(),
  /**
   * Dev / no-own-domain fallback. When set to a Postmark-default inbound
   * address (e.g. `<hex>@inbound.postmarkapp.com`), the dispatcher routes
   * by MailboxHash instead of by full recipient address. The hash IS the
   * team slug — users send to `<hex>+<slug>@inbound.postmarkapp.com`.
   *
   * Set EITHER this OR `INBOUND_EMAIL_DOMAIN`. When both are set,
   * MailboxHash routing wins (the explicit hash beats inferring from
   * domain).
   */
  POSTMARK_INBOUND_ADDRESS: z.string().optional(),
  /**
   * RFC 8601 authserv-id allowlist for trusted `Authentication-Results`
   * headers. Comma-separated; empty / unset means no AR header is trusted
   * (From-match path falls back to dev behavior). For Postmark production,
   * set to whatever Postmark stamps on the AR headers they generate (check
   * a real inbound payload in the dashboard — usually a domain like
   * `pm-inbound.postmarkapp.com` or your own MTA's hostname).
   */
  POSTMARK_AUTHSERV_IDS: z.string().optional(),
  /**
   * Source-IP allowlist for `/api/email/inbound`. Comma-separated CIDRs
   * (IPv4). When unset, IP-based filtering is skipped (dev / staging).
   * For Postmark production, populate with their published webhook source
   * IPs. Requests from outside the allowlist are rejected pre-auth with
   * 403 so attackers don't see auth-failure feedback.
   */
  POSTMARK_INBOUND_IPS: z.string().optional(),
  // Cloudflare Turnstile (Phase 13 abuse controls). Only public/anonymous
  // forms use it: email/password registration and public support/contact.
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  // Slack first-party conversational capture.
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  /**
   * Shared secret for protected cron / admin endpoints (e.g. job reconciler).
   * The caller passes `Authorization: Bearer <secret>`. When unset, the
   * endpoint is gated off entirely. Set this only on environments where a
   * cron schedule exists (Railway scheduler, GitHub Actions, etc.).
   */
  CRON_SECRET: z.string().optional(),

  // Sentry (optional)
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),

  // PostHog product analytics + feature flags. Browser-facing values are
  // intentionally public; server helpers no-op when the project key is unset.
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().default('https://eu.i.posthog.com'),

  // Phase 10 — Meeting bots. Provider defaults to Recall.ai. Set
  // RECALL_API_KEY + RECALL_STATUS_WEBHOOK_SECRET (Svix-signed status
  // events) to enable. RECALL_TRANSCRIPT_WEBHOOK_URL is passed to the
  // provider when starting a bot so transcripts stream back to us.
  RECALL_API_KEY: z.string().optional(),
  RECALL_BASE_URL: z.url().default('https://us-west-2.recall.ai/api/v1'),
  RECALL_STATUS_WEBHOOK_SECRET: z.string().optional(),
  RECALL_TRANSCRIPT_WEBHOOK_URL: z.preprocess(emptyStringAsUnset, z.url().optional()),
  /**
   * Recall recording-media retention for meeting bots.
   *
   * Unset / empty => timed retention for 1 hour. A positive integer is
   * interpreted as timed retention in hours. "forever" asks Recall to retain
   * indefinitely. Zero retention is intentionally unsupported because Recall's
   * zero-retention mode is incompatible with prioritize_accuracy transcription.
   */
  RECALL_RETENTION: z.preprocess(emptyStringAsUnset, z.string().optional()),
  /**
   * Bot display name. The bot still appears as a participant in silent
   * mode — meeting platforms surface it in the participant list. Defaults
   * to "Timeline" so attendees see a recognisable label rather than a
   * generic provider name.
   */
  RECALL_BOT_DISPLAY_NAME: z.string().default('Timeline'),

  // Phase 11 — Third-party integrations + custom MCPs.
  //
  // AES-256-GCM key (32 bytes, base64) used by
  // `packages/shared/src/crypto/secrets.ts` to encrypt every integration
  // auth secret (OAuth refresh+access tokens, bearer tokens, header
  // values, basic auth, MCP dynamic-client secrets) at rest. Required
  // when ANY integration or MCP server is configured. The helper throws
  // on first encrypt/decrypt if unset.
  //
  // Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  SECRETS_ENCRYPTION_KEY: z.string().optional(),

  // Per-team integrations. The catalog hides any native provider whose
  // OAuth credentials aren't set; provider-specific webhook secrets only
  // apply to providers that expose inbound webhooks.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  MONDAY_CLIENT_ID: z.string().optional(),
  MONDAY_CLIENT_SECRET: z.string().optional(),
  MONDAY_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_INTEGRATION_CLIENT_ID: z.string().optional(),
  SENTRY_INTEGRATION_CLIENT_SECRET: z.string().optional(),
  // HMAC secret for Google Drive push-channel tokens. The Drive watch
  // registration sets channel_token = HMAC-SHA256(secret, integration.id)
  // so the /api/webhooks/google-drive handler can verify the inbound
  // x-goog-channel-token. Without it, anyone who guesses or leaks an
  // integration UUID can trigger sync jobs for that team.
  GOOGLE_DRIVE_WEBHOOK_SECRET: z.string().optional(),
});

const schema = baseSchema
  .superRefine((env, ctx) => {
    if (env.LANGSMITH_TRACING && !env.LANGSMITH_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LANGSMITH_API_KEY'],
        message: 'LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true',
      });
    }
    // Web + full worker still need Auth.js secrets. The credential-thin
    // document-extract service must not require them (and should not set them).
    if (env.WORKER_MODE !== 'document-extract' && !env.AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'AUTH_SECRET is required unless WORKER_MODE=document-extract',
      });
    }
    // Dev escape hatch must never ship to production (full or extract worker).
    if (env.NODE_ENV === 'production' && env.DOCUMENT_EXTRACT_ALLOW_INPROCESS) {
      ctx.addIssue({
        code: 'custom',
        path: ['DOCUMENT_EXTRACT_ALLOW_INPROCESS'],
        message: 'DOCUMENT_EXTRACT_ALLOW_INPROCESS must be false in production',
      });
    }
    // Note: production full workers must set DOCUMENT_EXTRACT_ENABLED=false.
    // That gate lives in apps/worker (index.ts), not here — web also calls
    // getEnv() with WORKER_MODE defaulting to full and must not be rejected.
    if (env.WORKER_MODE === 'document-extract' && env.NODE_ENV === 'production') {
      const requiredOnExtract: { key: keyof typeof env; label: string }[] = [
        { key: 'DAYTONA_API_KEY', label: 'DAYTONA_API_KEY' },
        { key: 'OPENROUTER_API_KEY', label: 'OPENROUTER_API_KEY' },
        { key: 'REDIS_URL', label: 'REDIS_URL' },
        { key: 'S3_ENDPOINT', label: 'S3_ENDPOINT' },
        { key: 'S3_REGION', label: 'S3_REGION' },
        { key: 'S3_ACCESS_KEY_ID', label: 'S3_ACCESS_KEY_ID' },
        { key: 'S3_SECRET_ACCESS_KEY', label: 'S3_SECRET_ACCESS_KEY' },
        { key: 'S3_BUCKET_DOCUMENTS', label: 'S3_BUCKET_DOCUMENTS' },
      ];
      for (const { key, label } of requiredOnExtract) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${label} is required when WORKER_MODE=document-extract in production`,
          });
        }
      }
      // Credential-thin boundary (ADR 0013): allowlist against raw process.env
      // so unparsed secrets cannot survive a copied shared Railway env.
      assertDocumentExtractProcessEnvAllowlist(process.env, ctx);
    }
  })
  .transform((env) => ({
    ...env,
    LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? `timeline-${env.NODE_ENV}`,
  }));

export type Env = z.infer<typeof schema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (_env) return _env;
  const parsed = schema.safeParse(applyAuthAliases(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  _env = parsed.data;
  return _env;
}

/**
 * Reset the memoised env. Intended for test setup that mutates
 * `process.env` between cases; do not call from app code.
 */
export function resetEnvForTests(): void {
  _env = undefined;
}

/**
 * Auth.js / OAuth-state secret. Required for web and full worker; omitted
 * on the credential-thin document-extract service.
 */
export function requireAuthSecret(): string {
  const secret = getEnv().AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is required');
  }
  return secret;
}
