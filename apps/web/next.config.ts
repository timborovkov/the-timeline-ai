import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname + '/../../',
  transpilePackages: ['@timeline/shared', '@timeline/db'],
  eslint: {
    // CI runs `pnpm lint` separately with the root config.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
