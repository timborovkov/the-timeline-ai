import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('job recovery resuggest route', () => {
  it('uses a stable recovery job suffix so repeated clicks dedupe pending jobs', () => {
    const source = readFileSync(join(__dirname, 'route.ts'), 'utf-8');

    expect(source).toContain("const RECOVERY_JOB_ID_SUFFIX = 'recovery'");
    expect(source).toContain('previousQuietUntil');
    expect(source).toContain('removeSuggestionJob');
    expect(source).toContain('jobIdSuffix: RECOVERY_JOB_ID_SUFFIX');
    expect(source).not.toContain('recoveryRunId');
    expect(source).not.toContain('jobIdSuffix: `recovery:${');
  });
});
