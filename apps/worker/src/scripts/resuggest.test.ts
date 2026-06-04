import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('resuggest script', () => {
  it('uses a stable recovery suffix for conversation review jobs', () => {
    const source = readFileSync(new URL('./resuggest.ts', import.meta.url), 'utf8');

    expect(source).toContain("const RECOVERY_JOB_ID_SUFFIX = 'recovery'");
    expect(source).toContain('jobIdSuffix: RECOVERY_JOB_ID_SUFFIX');
    expect(source).not.toContain('recoveryRunId');
    expect(source).not.toContain('jobIdSuffix: `recovery:${');
  });
});
