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
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_RELEASE=$SENTRY_RELEASE
RUN bun run --filter @timeline/db build
RUN bun run --filter @timeline/shared build
RUN bun run --filter @timeline/worker build

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
COPY --from=builder --chown=bun:bun /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=bun:bun /app/apps/worker/document-extract-sandbox ./apps/worker/document-extract-sandbox
USER bun
CMD ["bun", "--no-env-file", "apps/worker/dist/index.js"]
