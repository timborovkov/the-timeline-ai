import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@timeline/shared', '@timeline/db'],
};

export default nextConfig;
