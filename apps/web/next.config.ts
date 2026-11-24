import { join } from 'node:path';

import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

import { e2eServerSplitChunks } from './scripts/e2e-webpack';
import { baseContentSecurityPolicy } from './src/lib/content-security-policy';
import {
  sensitiveLinkHeaders,
  sensitiveLinkHeaderSources,
  sensitiveLinkRequestLogPattern,
} from './src/lib/sensitive-links';

const workspaceRoot = join(__dirname, '../..');

const nextConfig: NextConfig = {
  output: 'standalone',
  redirects() {
    return Promise.resolve([
      { source: '/use-cases/work-record', destination: '/how-it-works', permanent: true },
      { source: '/use-cases/crm', destination: '/use-cases/customer-context', permanent: true },
    ]);
  },
  images: {
    localPatterns: [
      // Public screenshot revisions keep the optimized cache coherent after recaptures.
      { pathname: '/marketing/screenshots/*.png' },
      { pathname: '/**', search: '' },
    ],
  },
  // Load routes on first use instead of retaining every server bundle at startup.
  // This trades cold-route latency for a lower idle footprint on Railway.
  experimental: {
    preloadEntriesOnStart: false,
  },
  // Next 16 logs Server Function arguments by default, including auth form data.
  logging: {
    serverFunctions: false,
    incomingRequests: {
      ignore: [
        sensitiveLinkRequestLogPattern,
        /^(?:https?:\/\/[^/]+)?\/app\/team\/guests(?:[/?]|$)/i,
      ],
    },
  },
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    '/app/connect-agent/skill': ['../../plugins/timeline/skills/timeline/SKILL.md'],
    '/agents/[doc]': ['../../plugins/timeline/skills/timeline/SKILL.md'],
  },
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: ['@timeline/shared', '@timeline/db'],
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          baseContentSecurityPolicy,
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
            : []),
        ],
      },
      ...sensitiveLinkHeaderSources.map((source) => ({
        source,
        headers: [...sensitiveLinkHeaders],
      })),
    ]);
  },
  // `postgres` is a CJS module with native pg-wire code paths that webpack
  // sometimes mangles when bundling for the server runtime. Keep both this
  // and drizzle-orm as real node_modules in the standalone output. Runtime
  // startup migrations are handled by apps/web/start.mjs outside Next's
  // instrumentation bundle.
  serverExternalPackages: ['bullmq', 'drizzle-orm', 'ioredis', 'postgres'],
  webpack(
    config: {
      externals: Record<string, string>[];
      optimization: { splitChunks?: Parameters<typeof e2eServerSplitChunks>[0] };
    },
    { isServer, dev, nextRuntime },
  ) {
    if (dev && nextRuntime === 'nodejs' && process.env.E2E_DEV_SHARED_SERVER_CHUNKS === '1') {
      config.optimization.splitChunks = e2eServerSplitChunks(
        config.optimization.splitChunks,
        workspaceRoot,
      );
    }
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
  // Browser envelopes POST to the App Router handler at /sentry-tunnel.
  // Do not set `tunnelRoute`: Next 16.3+ implements that option as a rewrite
  // through proxyRequest/httpxy, which stacks 11 `close` listeners on the
  // Node ServerResponse and trips MaxListenersExceededWarning.
  silent: !process.env.CI,
  widenClientFileUpload: Boolean(process.env.SENTRY_AUTH_TOKEN),
};

export default withSentryConfig(nextConfig, sentryOptions);
