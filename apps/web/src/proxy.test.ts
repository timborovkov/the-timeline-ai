import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('proxy matcher', () => {
  it('excludes the Sentry tunnel route', () => {
    const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(source).toContain('sentry-tunnel');
  });
});
