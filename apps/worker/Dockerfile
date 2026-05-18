# syntax=docker/dockerfile:1.7

# ---- Base ----
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- Pruner ----
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.1.0 prune @timeline/worker --docker

# ---- Deps ----
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @timeline/db build
RUN pnpm --filter @timeline/shared build
RUN pnpm --filter @timeline/worker build

# ---- Deployer ----
# pnpm deploy creates a self-contained directory with a flat node_modules (no symlinks).
# This is the correct way to deploy a pnpm workspace package to production.
FROM base AS deployer
COPY --from=builder /app/ .
RUN pnpm deploy --filter @timeline/worker --prod /prod/worker

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 worker

COPY --from=deployer --chown=worker:nodejs /prod/worker ./

USER worker

# Default entry; Railway overrides start command per worker service.
CMD ["node", "dist/index.js"]
