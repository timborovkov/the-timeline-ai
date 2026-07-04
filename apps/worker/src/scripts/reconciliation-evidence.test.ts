import { describe, expect, it, vi } from 'vitest';

import type { Db } from '@timeline/db';

import {
  parseArgs,
  ReconciliationEvidenceUsageError,
  runReconciliationEvidenceCli,
} from '#src/scripts/reconciliation-evidence.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';

describe('reconciliation evidence script', () => {
  it('parses release-gate audit options', () => {
    expect(
      parseArgs([
        `--team=${TEAM_ID}`,
        '--mode=audit',
        '--source=email',
        '--limit=50',
        '--page-size=10',
        '--allow-degraded-source=web',
        '--allow-degraded-source=slack',
        '--fail-on-release-gate',
      ]),
    ).toMatchObject({
      teamId: TEAM_ID,
      mode: 'audit',
      source: 'email',
      limit: 50,
      pageSize: 10,
      allowedDegradedReplaySources: ['web', 'slack'],
      failOnReleaseGate: true,
    });
  });

  it('throws a typed usage error for invalid release-gate sources', () => {
    expect(() => parseArgs([`--team=${TEAM_ID}`, '--allow-degraded-source=not-a-source'])).toThrow(
      ReconciliationEvidenceUsageError,
    );
  });

  it('sets exit code when the release gate fails', async () => {
    const exitCodes: number[] = [];
    const writes: string[] = [];
    const audit = vi.fn().mockResolvedValue({
      teamId: TEAM_ID,
      source: 'all',
      totalRawEvents: 1,
      normalizedRawEvents: 0,
      missingRawEvents: 1,
      fullReplayEvidence: 0,
      degradedReplayEvidence: 0,
      bySource: {},
      releaseGate: {
        passed: false,
        failureCount: 1,
        failures: [
          {
            source: 'email',
            code: 'missing_evidence',
            rawEventCount: 1,
            message: 'email has 1 raw event without reconciliation evidence',
          },
        ],
      },
    });

    await runReconciliationEvidenceCli(parseArgs([`--team=${TEAM_ID}`, '--fail-on-release-gate']), {
      db: {} as Db,
      audit,
      write: (text) => writes.push(text),
      setExitCode: (code) => exitCodes.push(code),
    });

    expect(exitCodes).toEqual([1]);
    expect(JSON.parse(writes[0] ?? '{}')).toMatchObject({
      mode: 'audit',
      report: { releaseGate: { passed: false, failureCount: 1 } },
    });
  });

  it('forwards allowlisted degraded sources into the audit input', async () => {
    const audit = vi.fn().mockResolvedValue({
      teamId: TEAM_ID,
      source: 'all',
      totalRawEvents: 0,
      normalizedRawEvents: 0,
      missingRawEvents: 0,
      fullReplayEvidence: 0,
      degradedReplayEvidence: 0,
      bySource: {},
      releaseGate: { passed: true, failureCount: 0, failures: [] },
    });

    await runReconciliationEvidenceCli(
      parseArgs([`--team=${TEAM_ID}`, '--allow-degraded-source=web']),
      {
        db: {} as Db,
        audit,
        write: () => undefined,
        setExitCode: () => undefined,
      },
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ allowedDegradedReplaySources: ['web'] }),
    );
  });
});
