import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface RailwayConfig {
  deploy?: {
    preDeployCommand?: string[];
    startCommand?: string;
  };
}

describe('Railway web config', () => {
  it('runs deploy and start commands with node in production mode', () => {
    const config = JSON.parse(
      readFileSync(new URL('../railway.json', import.meta.url), 'utf8'),
    ) as RailwayConfig;

    expect(config.deploy?.preDeployCommand).toEqual([
      'NODE_ENV=production node packages/db/dist/migrate.js',
    ]);
    expect(config.deploy?.startCommand).toBe('NODE_ENV=production node apps/web/start.mjs');
    expect(config.deploy?.preDeployCommand?.join(' ')).not.toContain('pnpm');
    expect(config.deploy?.startCommand).not.toContain('pnpm');
    expect(config.deploy?.startCommand).not.toContain('NODE_ENV=staging');
  });

  it('copies Next static assets into the standalone server bundle during builds', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toContain('node scripts/prepare-standalone.mjs');
  });

  it('passes Sentry runtime and build variables through Docker app profile', () => {
    const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');
    const dockerfile = readFileSync(
      new URL('../../../docker/web.Dockerfile', import.meta.url),
      'utf8',
    );

    expect(compose).toContain('dockerfile: docker/web.Dockerfile');
    expect(compose).toContain('SENTRY_DSN: ${SENTRY_DSN:-}');
    expect(compose).toContain('NEXT_PUBLIC_SENTRY_DSN: ${NEXT_PUBLIC_SENTRY_DSN:-}');
    expect(compose).toContain(
      'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: ${NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE:-0}',
    );
    expect(compose).toContain(
      'NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: ${NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE:-0}',
    );
    expect(compose).toContain('SENTRY_RELEASE: ${SENTRY_RELEASE:-}');
    expect(dockerfile).toContain('ARG SENTRY_AUTH_TOKEN');
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_SENTRY_DSN');
    expect(dockerfile).toContain('ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN');
    expect(dockerfile).toContain('ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN');
  });
});
