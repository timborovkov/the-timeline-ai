import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('@timeline/shared development package exports', () => {
  it.each([
    ['@timeline/shared', '../index.ts'],
    ['@timeline/shared/email', './index.ts'],
    ['@timeline/shared/integrations/registry', '../integrations/registry.ts'],
    ['@timeline/shared/logger', '../logger.ts'],
    ['@timeline/shared/rate-limit', '../rate-limit/index.ts'],
    ['@timeline/shared/slug', '../slug.ts'],
  ])('resolves %s to source for development consumers', (specifier, sourcePath) => {
    const result = spawnSync(
      process.execPath,
      [
        '--conditions=development',
        '--input-type=module',
        '--eval',
        `console.log(import.meta.resolve('${specifier}'))`,
      ],
      {
        cwd: fileURLToPath(new URL('../../../../apps/web/', import.meta.url)),
        encoding: 'utf8',
      },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(new URL(sourcePath, import.meta.url).href);
  });
});
