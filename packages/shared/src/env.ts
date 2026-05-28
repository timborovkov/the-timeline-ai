import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // Auth
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 chars'),
  AUTH_URL: z.string().url().default('http://localhost:3000'),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis (optional in Phase 1; required from Phase 3)
  REDIS_URL: z.string().url().optional(),

  // Qdrant (Phase 5+)
  QDRANT_URL: z.string().url().optional(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('events'),

  // S3 / RustFS (Phase 3+)
  S3_ENDPOINT: z.string().url().optional(),
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
  S3_PUBLIC_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
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
  OPENROUTER_BASE_URL: z.string().url().optional(),

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
  SUPPORT_EMAIL: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
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

  // Phase 10 — Meeting bots. Provider defaults to Recall.ai. Set
  // RECALL_API_KEY + RECALL_STATUS_WEBHOOK_SECRET (Svix-signed status
  // events) to enable. RECALL_TRANSCRIPT_WEBHOOK_URL is passed to the
  // provider when starting a bot so transcripts stream back to us.
  RECALL_API_KEY: z.string().optional(),
  RECALL_BASE_URL: z.string().url().default('https://us-west-2.recall.ai/api/v1'),
  RECALL_STATUS_WEBHOOK_SECRET: z.string().optional(),
  RECALL_TRANSCRIPT_WEBHOOK_URL: z.string().url().optional(),
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

  // Per-team integrations. The catalog hides any provider whose
  // credentials aren't set; webhook secrets gate signature verification
  // on the corresponding /api/webhooks/* endpoint.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  // HMAC secret for Google Drive push-channel tokens. The Drive watch
  // registration sets channel_token = HMAC-SHA256(secret, integration.id)
  // so the /api/webhooks/google-drive handler can verify the inbound
  // x-goog-channel-token. Without it, anyone who guesses or leaks an
  // integration UUID can trigger sync jobs for that team.
  GOOGLE_DRIVE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (_env) return _env;
  const parsed = schema.safeParse(process.env);
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
