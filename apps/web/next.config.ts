import { join } from 'node:path';

import { withSentryConfig } from '@sentry/nextjs';

import type { NextConfig } from 'next';

const workspaceRoot = join(__dirname, '../..');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: ['@timeline/shared', '@timeline/db'],
  headers() {
    return Promise.resolve([
      {
        source: '/oauth/authorize',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]);
  },
  // `postgres` is a CJS module with native pg-wire code paths that webpack
  // sometimes mangles when bundling for the server runtime. Keep both this
  // and drizzle-orm as real node_modules in the standalone output. Runtime
  // startup migrations are handled by apps/web/start.mjs outside Next's
  // instrumentation bundle.
  serverExternalPackages: ['bullmq', 'drizzle-orm', 'ioredis', 'postgres'],
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals.push({
        bullmq: 'commonjs bullmq',
        ioredis: 'commonjs ioredis',
      });
    }
    return config;
  },
};

const sentryOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: '/sentry-tunnel',
  silent: !process.env.CI,
  widenClientFileUpload: Boolean(process.env.SENTRY_AUTH_TOKEN),
};

export default withSentryConfig(nextConfig, sentryOptions);
