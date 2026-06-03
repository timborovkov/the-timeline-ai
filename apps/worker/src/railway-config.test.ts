import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface RailwayConfig {
  deploy?: {
    startCommand?: string;
  };
}

describe('Railway worker config', () => {
  it('starts with node in production mode at runtime', () => {
    const config = JSON.parse(
      readFileSync(new URL('../railway.json', import.meta.url), 'utf8'),
    ) as RailwayConfig;

    expect(config.deploy?.startCommand).toBe('NODE_ENV=production node apps/worker/dist/index.js');
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
