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
});
