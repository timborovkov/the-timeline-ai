import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    env: {
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
      AUTH_SECRET: 'test-secret-at-least-sixteen-characters',
      S3_BUCKET_DOCUMENTS: 'test-documents',
    },
  },
});
