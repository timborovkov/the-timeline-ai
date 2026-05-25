# syntax=docker/dockerfile:1.7

# ---- Base ----
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- Pruner ----
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.1.0 prune @timeline/web --docker

# ---- Deps ----
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
# turbo prune excludes root-level config; copy it explicitly
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @timeline/db build
RUN pnpm --filter @timeline/shared build
RUN pnpm --filter @timeline/web build

# ---- DB deployer ----
# `pnpm deploy --prod` creates a self-contained directory for @timeline/db
# with a flat node_modules (no pnpm symlinks). This is what we ship to the
# runner so Railway's preDeployCommand can run `node packages/db/dist/migrate.js`
# and have it resolve `drizzle-orm` and `postgres` cleanly.
#
# Why not rely on Next.js standalone tracing? Next bundles drizzle-orm/postgres
# into webpack server chunks and only emits intermittent pnpm-style symlinks
# in the standalone output — not reliable for a sibling Node entrypoint.
FROM base AS db-deployer
COPY --from=builder /app/ .
RUN pnpm deploy --filter @timeline/db --prod /prod/db

# ---- Runner ----
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Self-contained @timeline/db with its own node_modules (postgres, drizzle-orm,
# drizzle/*.sql, meta/_journal.json). Sits alongside the Next standalone tree
# so Railway's preDeployCommand resolves modules from packages/db/node_modules/.
COPY --from=db-deployer --chown=nextjs:nodejs /prod/db ./packages/db

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
