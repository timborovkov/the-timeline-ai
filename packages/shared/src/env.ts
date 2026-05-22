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
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().optional(),
  S3_BUCKET_AUDIO: z.string().optional(),
  S3_BUCKET_ATTACHMENTS: z.string().optional(),
  S3_BUCKET_EXPORTS: z.string().optional(),

  // OpenRouter (Phase 3+)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  TRANSCRIPTION_MODEL: z.string().optional(),
  CHAT_MODEL_DEFAULT: z.string().optional(),
  EXTRACTION_MODEL: z.string().optional(),
  /**
   * Phase 6 agent chat model. Lets us point chat at a stronger model than
   * extraction (e.g. `openai/gpt-4o`) without changing extraction behavior.
   * Resolution chain: AGENT_MODEL ?? CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini'.
   */
  AGENT_MODEL: z.string().optional(),

  // Telegram (Phase 2+)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),

  // Postmark (Phase 7)
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  POSTMARK_WEBHOOK_SECRET: z.string().optional(),
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
