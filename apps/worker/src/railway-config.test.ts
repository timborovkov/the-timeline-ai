import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
interface RailwayConfig {
  build?: { builder?: string; dockerfilePath?: string };
  deploy: {
    preDeployCommand: string[];
    startCommand: string;
  };
}

describe('Railway worker config', () => {
  it.each(['../railway.json', '../railway.extract.json', '../../web/railway.json'])(
    '%s launches production commands without relying on a shell',
    (path) => {
      const config = JSON.parse(
        readFileSync(new URL(path, import.meta.url), 'utf8'),
      ) as RailwayConfig;
      for (const command of [config.deploy.startCommand, ...config.deploy.preDeployCommand]) {
        const args = command.split(' ');
        const executable = args.shift() ?? '';
        // Replace only the application entrypoint to avoid migrations or worker side effects.
        args.splice(-1, 1, '-e', 'console.log(process.env.NODE_ENV, !!process.versions.bun)');
        const result = spawnSync(executable, args, { encoding: 'utf8' });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('production true');
      }
    },
  );

  it('runs deploy and start commands with Bun in production mode', () => {
    const config = JSON.parse(
      readFileSync(new URL('../railway.json', import.meta.url), 'utf8'),
    ) as RailwayConfig;

    expect(config.build?.builder).toBe('DOCKERFILE');
    expect(config.build?.dockerfilePath).toBe('docker/worker.Dockerfile');
    expect(config.deploy.preDeployCommand).toEqual([
      'env NODE_ENV=production bun --no-env-file packages/db/dist/migrate.js',
    ]);
    expect(config.deploy.startCommand).toBe(
      'env NODE_ENV=production bun --no-env-file apps/worker/dist/index.js',
    );
    expect(config.deploy.preDeployCommand.join(' ')).not.toContain('pnpm');
    expect(config.deploy.startCommand).not.toContain('pnpm');
    expect(config.deploy.startCommand).not.toContain('NODE_ENV=staging');
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
