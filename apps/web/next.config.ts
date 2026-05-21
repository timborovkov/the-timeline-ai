import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname + '/../../',
  transpilePackages: ['@timeline/shared', '@timeline/db'],
  // `postgres` is a CJS module with native pg-wire code paths that webpack
  // sometimes mangles when bundling for the server runtime. Keep both this
  // and drizzle-orm as real node_modules in the standalone output. This is
  // independent of the Railway migrate setup — the migrate.js entrypoint
  // ships via the db-deployer stage in apps/web/Dockerfile (see runner
  // stage), not via Next's tracing.
  serverExternalPackages: ['drizzle-orm', 'postgres'],
  eslint: {
    // CI runs `pnpm lint` separately with the root config.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
