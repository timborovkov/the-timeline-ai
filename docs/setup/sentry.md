# Sentry setup

> Optional in Phase 1. Strongly recommended before production.

## 1. Project

1. Sign up at <https://sentry.io>.
2. Create a project — platform `next-js` for web, `node-express` for worker.
3. Copy the DSN.

Set in `.env`:

```bash
SENTRY_DSN=https://...@o0.ingest.sentry.io/0
SENTRY_ENVIRONMENT=development
```

## 2. Wiring

Initialization lands when this becomes a phase priority. For now: env vars are
accepted and read by `packages/shared/env.ts`; if absent, the app runs without
error tracking and logs a warning at startup.
