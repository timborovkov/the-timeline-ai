import { describe, expect, it } from 'vitest';

import { jobRecoveryRowHint } from '@/components/job-recovery/job-recovery-row-hint';

describe('jobRecoveryRowHint', () => {
  it('names job and artifact ids and includes the formatted time', () => {
    const hint = jobRecoveryRowHint(
      {
        id: 'job-1',
        artifactId: 'raw-event-1',
        detectedAt: new Date('2026-07-02T10:00:00.000Z'),
        error: null,
      },
      'UTC',
    );

    expect(hint).toContain('Job ID: job-1 | Artifact UUID: raw-event-1');
    expect(hint).toContain('Jul 2, 2026');
    expect(hint).not.toContain('timed out');
  });

  it('appends the raw provider error when present', () => {
    const hint = jobRecoveryRowHint(
      {
        id: 'job-1',
        artifactId: 'raw-event-1',
        detectedAt: new Date('2026-07-02T10:00:00.000Z'),
        error: 'Audio service timed out',
      },
      'UTC',
    );

    expect(hint).toContain('Audio service timed out');
  });
});
