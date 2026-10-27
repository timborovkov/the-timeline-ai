# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.4-debian AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/test-support/package.json ./packages/test-support/package.json
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    bun install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE
ENV NEXT_TELEMETRY_DISABLED=1
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ENV NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE
RUN bun run --filter @timeline/db build
RUN bun run --filter @timeline/shared build
# Auth initialization runs before Next detects dynamic pages. These build-only
# placeholders are never retained in the runtime image or used for connections.
RUN AUTH_SECRET=build-only-secret-at-least-sixteen-characters \
    DATABASE_URL=postgres://build_only@127.0.0.1:5432/build_only \
    bun run --filter @timeline/web build

FROM base AS production-dependencies
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/test-support/package.json ./packages/test-support/package.json
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    bun install --frozen-lockfile --production

FROM base AS runner
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=bun:bun /app/ ./
COPY --from=builder --chown=bun:bun /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=bun:bun /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder --chown=bun:bun /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=bun:bun /app/apps/web/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=bun:bun /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=bun:bun /app/apps/web/start.mjs ./apps/web/start.mjs
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
USER bun
EXPOSE 3000
CMD ["bun", "--no-env-file", "apps/web/start.mjs"]
