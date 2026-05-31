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
});
