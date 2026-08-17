import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { filterExpectedTestConsole } from '../../scripts/vitest-console';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // The web suite includes several PGlite and browser-emulation tests. Capping workers keeps
    // those resource-heavy files from starving interaction tests and tripping false timeouts.
    maxWorkers: 4,
    env: {
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
      AUTH_SECRET: 'test-secret-at-least-sixteen-characters',
      S3_BUCKET_DOCUMENTS: 'test-documents',
    },
    onConsoleLog: filterExpectedTestConsole,
  },
});
