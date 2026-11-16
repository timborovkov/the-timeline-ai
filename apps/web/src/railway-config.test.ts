import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import type { NextConfig } from 'next';

interface RailwayConfig {
  build?: { builder?: string; dockerfilePath?: string };
  deploy?: {
    preDeployCommand?: string[];
    startCommand?: string;
  };
}

describe('Railway web config', () => {
  it('runs deploy and start commands with Bun in production mode', () => {
    const config = JSON.parse(
      readFileSync(new URL('../railway.json', import.meta.url), 'utf8'),
    ) as RailwayConfig;

    expect(config.build?.builder).toBe('DOCKERFILE');
    expect(config.build?.dockerfilePath).toBe('docker/web.Dockerfile');
    expect(config.deploy?.preDeployCommand).toEqual([
      'env NODE_ENV=production bun --bun --no-env-file packages/db/dist/migrate.js',
    ]);
    expect(config.deploy?.startCommand).toBe(
      'env NODE_ENV=production bun --bun --no-env-file apps/web/start.mjs',
    );
    expect(config.deploy?.preDeployCommand?.join(' ')).not.toContain('pnpm');
    expect(config.deploy?.startCommand).not.toContain('pnpm');
    expect(config.deploy?.startCommand).not.toMatch(/\bnode\b/);
    expect(config.deploy?.startCommand).not.toContain('NODE_ENV=staging');
  });

  it('copies static and email-template runtime assets into the standalone server bundle', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const prepareStandalone = readFileSync(
      new URL('../scripts/prepare-standalone.mjs', import.meta.url),
      'utf8',
    );

    expect(packageJson.scripts?.build).toContain('bun scripts/prepare-standalone.mjs');
    expect(prepareStandalone).toContain(
      "const standaloneRoot = resolve(appRoot, '.next/standalone')",
    );
    expect(prepareStandalone).toContain(
      "resolve(standaloneRoot, 'packages/shared/dist/messaging/email-templates')",
    );
    expect(prepareStandalone).toContain(
      "resolve(standaloneAppRoot, 'packages/shared/dist/messaging/email-templates')",
    );
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
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_POSTHOG_KEY');
    expect(dockerfile).toContain('ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY');
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_POSTHOG_HOST');
    expect(dockerfile).toContain('ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST');
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_POSTHOG_UI_HOST');
    expect(dockerfile).toContain('ENV NEXT_PUBLIC_POSTHOG_UI_HOST=$NEXT_PUBLIC_POSTHOG_UI_HOST');
    expect(dockerfile).toContain('FROM oven/bun:1.4.4-debian AS base');
    expect(dockerfile).toContain('CMD ["bun", "--bun", "--no-env-file", "apps/web/start.mjs"]');
  });

  it('stamps Bun on the Node server Sentry path and keeps Edge/browser free of process.versions', () => {
    const server = readFileSync(new URL('./sentry.server.config.ts', import.meta.url), 'utf8');
    const edge = readFileSync(new URL('./sentry.edge.config.ts', import.meta.url), 'utf8');
    const client = readFileSync(new URL('./instrumentation-client.ts', import.meta.url), 'utf8');

    expect(server).toContain("from '@timeline/shared/monitoring/sentry-runtime'");
    expect(server).toContain('stampSentryRuntimeContext');
    expect(edge).not.toContain('sentry-runtime');
    expect(client).not.toContain('sentry-runtime');
  });

  it('disables Next.js route preloading so unused server bundles stay off the idle heap', () => {
    const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
    const readme = readFileSync(new URL('../../../docs/railway.md', import.meta.url), 'utf8');
    const experimental: NonNullable<NextConfig['experimental']> = {
      preloadEntriesOnStart: false,
    };

    expect(config).toMatch(/^\s*preloadEntriesOnStart:\s*false,/m);
    expect(experimental.preloadEntriesOnStart).toBe(false);
    expect(readme).toContain('experimental.preloadEntriesOnStart');
    expect(readme).toContain('trading cold-route latency for lower idle memory');
  });

  it('supplies the canonical public origin while prerendering the web image', () => {
    const dockerfile = readFileSync(
      new URL('../../../docker/web.Dockerfile', import.meta.url),
      'utf8',
    );
    const authUrlArg = dockerfile.indexOf('ARG AUTH_URL=https://thetimeline.cc');
    const authUrlEnv = dockerfile.indexOf('ENV AUTH_URL=$AUTH_URL');
    const webBuild = dockerfile.indexOf('bun run --filter @timeline/web build');

    expect(authUrlArg).toBeGreaterThan(-1);
    expect(authUrlEnv).toBeGreaterThan(authUrlArg);
    expect(webBuild).toBeGreaterThan(authUrlEnv);
    expect(dockerfile).not.toContain('ARG SUPPORT_EMAIL');
    expect(dockerfile).not.toContain('ARG TURNSTILE_SITE_KEY');
    expect(dockerfile).not.toContain('ARG LEGAL_PUBLICATION_READY');
  });
});
