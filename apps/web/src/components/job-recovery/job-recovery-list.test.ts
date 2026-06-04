import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('JobRecoveryList', () => {
  it('uses product recovery language instead of BullMQ internals', () => {
    const source = readFileSync(join(__dirname, 'job-recovery-list.tsx'), 'utf-8');

    expect(source).toContain('Transcription');
    expect(source).toContain('Extraction');
    expect(source).toContain('Embedding');
    expect(source).toContain('Documents');
    expect(source).toContain('Meetings');
    expect(source).toContain('Integrations');
    expect(source).toContain('Retry');
    expect(source).toContain('Dismiss');
    expect(source).not.toContain('BullMQ');
    expect(source).not.toContain('jobId');
    expect(source).not.toContain('waiting');
    expect(source).not.toContain('delayed');
  });

  it('keys transient retry and dismiss state to the current job snapshot', () => {
    const source = readFileSync(join(__dirname, 'job-recovery-list.tsx'), 'utf-8');

    expect(source).toContain('const retryStartedAt = Date.now()');
    expect(source).toContain('new Date(finished.finishedAt).getTime() >= snapshot.startedAt');
    expect(source).not.toContain('snapshot.startedAt - 1_000');
    expect(source).toContain('function itemSnapshotKey');
    expect(source).toContain('new Date(item.detectedAt).toISOString()');
  });
});
