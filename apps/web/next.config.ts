import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname + '/../../',
  transpilePackages: ['@timeline/shared', '@timeline/db'],
  // `postgres` is a CJS module with native pg-wire code paths that webpack
  // sometimes mangles when bundling for the server runtime. Keep both this
  // and drizzle-orm as real node_modules in the standalone output. Runtime
  // startup migrations are handled by apps/web/start.mjs outside Next's
  // instrumentation bundle.
  serverExternalPackages: ['drizzle-orm', 'postgres'],
  eslint: {
    // CI runs `pnpm lint` separately with the root config.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
