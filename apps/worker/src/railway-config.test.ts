import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
interface RailwayConfig {
  build?: { builder?: string; dockerfilePath?: string };
  deploy?: {
    preDeployCommand?: string[];
    startCommand?: string;
  };
}

describe('Railway worker config', () => {
  it('runs deploy and start commands with Bun in production mode', () => {
    const config = JSON.parse(
      readFileSync(new URL('../railway.json', import.meta.url), 'utf8'),
    ) as RailwayConfig;

    expect(config.build?.builder).toBe('DOCKERFILE');
    expect(config.build?.dockerfilePath).toBe('docker/worker.Dockerfile');
    expect(config.deploy?.preDeployCommand).toEqual([
      'NODE_ENV=production bun --no-env-file packages/db/dist/migrate.js',
    ]);
    expect(config.deploy?.startCommand).toBe(
      'NODE_ENV=production bun --no-env-file apps/worker/dist/index.js',
    );
    expect(config.deploy?.preDeployCommand?.join(' ')).not.toContain('pnpm');
    expect(config.deploy?.startCommand).not.toContain('pnpm');
    expect(config.deploy?.startCommand).not.toContain('NODE_ENV=staging');
  });

  it('passes Sentry runtime and build variables through Docker app profile', () => {
    const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');
    const dockerfile = readFileSync(
      new URL('../../../docker/worker.Dockerfile', import.meta.url),
      'utf8',
    );

    expect(compose).toContain('dockerfile: docker/worker.Dockerfile');
    expect(compose).toContain('SENTRY_DSN: ${SENTRY_DSN:-}');
    expect(compose).toContain('SENTRY_ENVIRONMENT: ${SENTRY_ENVIRONMENT:-development}');
    expect(compose).toContain('SENTRY_RELEASE: ${SENTRY_RELEASE:-}');
    expect(dockerfile).toContain('ARG SENTRY_AUTH_TOKEN');
    expect(dockerfile).toContain('ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN');
  });
});
