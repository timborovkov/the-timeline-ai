import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

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

  // Telegram (Phase 2+)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  // Postmark (Phase 7)
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  POSTMARK_WEBHOOK_SECRET: z.string().optional(),
  INBOUND_EMAIL_DOMAIN: z.string().optional(),

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
