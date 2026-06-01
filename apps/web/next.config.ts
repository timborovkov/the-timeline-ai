import { join } from 'node:path';

import type { NextConfig } from 'next';

const workspaceRoot = join(__dirname, '../..');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: ['@timeline/shared', '@timeline/db'],
  // `postgres` is a CJS module with native pg-wire code paths that webpack
  // sometimes mangles when bundling for the server runtime. Keep both this
  // and drizzle-orm as real node_modules in the standalone output. Runtime
  // startup migrations are handled by apps/web/start.mjs outside Next's
  // instrumentation bundle.
  serverExternalPackages: ['drizzle-orm', 'postgres'],
};

export default nextConfig;
