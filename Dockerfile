# syntax=docker/dockerfile:1.7

# ---- Base ----
# Pinned Node version. Update deliberately, not via :latest.
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- Pruner ----
# Use turbo prune to create a partial monorepo with only what `web` needs.
# This keeps the build context small and the layer cache effective.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.1.0 prune @timeline/web --docker

# ---- Deps ----
# Install only the deps the pruned subset needs.
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @timeline/web build

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Next.js standalone output bundles the minimal node_modules subset needed at runtime.
# Requires `output: 'standalone'` in next.config.js.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

# server.js is created by the standalone output at the path matching the app.
CMD ["node", "apps/web/server.js"]
