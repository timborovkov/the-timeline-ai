import { describe, expect, it, vi } from 'vitest';

import {
  parseArgs,
  ReconciliationProductionSamplingUsageError,
  runReconciliationProductionSamplingCli,
} from '#src/scripts/reconciliation-production-sampling.js';

describe('reconciliation production sampling script', () => {
  it('parses repeatable inputs and the failure gate', () => {
    expect(
      parseArgs([
        '--input=/tmp/run-a',
        '--input=/tmp/run-b/report.json',
        '--out=/tmp/report.json',
        '--run-kind=closed_beta',
        '--fail-on-failures',
        '--confirm-fixture=customer-project-email:abc123',
        '--confirm-fixture=incident-response:def456',
      ]),
    ).toEqual({
      inputPaths: ['/tmp/run-a', '/tmp/run-b/report.json'],
      outputPath: '/tmp/report.json',
      runKind: 'closed_beta',
      failOnFailures: true,
      confirmedFixtureCandidates: [
        { caseName: 'customer-project-email', packetFingerprint: 'abc123' },
        { caseName: 'incident-response', packetFingerprint: 'def456' },
      ],
    });
  });

  it('throws a typed usage error for invalid run kinds', () => {
    expect(() =>
      parseArgs(['--input=/tmp/run', '--out=/tmp/report.json', '--run-kind=nightly']),
    ).toThrow(ReconciliationProductionSamplingUsageError);
  });

  it('throws a typed usage error for malformed confirmed fixtures', () => {
    expect(() =>
      parseArgs(['--input=/tmp/run', '--out=/tmp/report.json', '--confirm-fixture=missing-colon']),
    ).toThrow(ReconciliationProductionSamplingUsageError);
  });

  it('sets exit code when requested and the report has failed samples', async () => {
    const writes: string[] = [];
    const exitCodes: number[] = [];
    const writeReport = vi.fn().mockResolvedValue({
      path: '/tmp/report.json',
      report: {
        runKind: 'closed_beta',
        manifestCount: 1,
        sampleCount: 2,
        passedCount: 1,
        failedCount: 1,
        passRate: 0.5,
        fixtureCandidateCount: 1,
        confirmedFixtureCandidateCount: 1,
        unconfirmedFixtureCandidateCount: 0,
      },
      runId: 'run-1',
      loaded: {
        ignoredFiles: [{ path: '/tmp/run/private.txt', reason: 'unsupported_file' }],
      },
    });

    await runReconciliationProductionSamplingCli(
      parseArgs([
        '--input=/tmp/run',
        '--out=/tmp/report.json',
        '--run-kind=closed_beta',
        '--fail-on-failures',
        '--confirm-fixture=customer-project-email:abc123',
      ]),
      {
        writeReport,
        write: (text) => writes.push(text),
        setExitCode: (code) => exitCodes.push(code),
      },
    );

    expect(writeReport).toHaveBeenCalledWith({
      inputPaths: ['/tmp/run'],
      outputPath: '/tmp/report.json',
      runKind: 'closed_beta',
      confirmedFixtureCandidates: [
        { caseName: 'customer-project-email', packetFingerprint: 'abc123' },
      ],
    });
    expect(exitCodes).toEqual([1]);
    expect(JSON.parse(writes[0] ?? '{}')).toMatchObject({
      outputPath: '/tmp/report.json',
      runKind: 'closed_beta',
      failedCount: 1,
      fixtureCandidateCount: 1,
      confirmedFixtureCandidateCount: 1,
      unconfirmedFixtureCandidateCount: 0,
      runId: 'run-1',
      ignoredFiles: [{ path: '/tmp/run/private.txt', reason: 'unsupported_file' }],
    });
  });

  it('passes the database and team when dashboard ingestion is requested', async () => {
    const writes: string[] = [];
    const db = {} as never;
    const writeReport = vi.fn().mockResolvedValue({
      path: '/tmp/report.json',
      runId: 'production-sampling-run-1',
      report: {
        runKind: 'post_deploy',
        manifestCount: 1,
        sampleCount: 1,
        passedCount: 1,
        failedCount: 0,
        passRate: 1,
        fixtureCandidateCount: 0,
        confirmedFixtureCandidateCount: 0,
        unconfirmedFixtureCandidateCount: 0,
      },
      loaded: { ignoredFiles: [] },
    });

    await runReconciliationProductionSamplingCli(
      parseArgs([
        '--input=/tmp/run',
        '--out=/tmp/report.json',
        '--team=11111111-1111-4111-8111-111111111111',
        '--run-kind=post_deploy',
      ]),
      {
        db,
        writeReport,
        write: (text) => writes.push(text),
      },
    );

    expect(writeReport).toHaveBeenCalledWith({
      inputPaths: ['/tmp/run'],
      outputPath: '/tmp/report.json',
      runKind: 'post_deploy',
      confirmedFixtureCandidates: [],
      teamId: '11111111-1111-4111-8111-111111111111',
      db,
    });
    expect(JSON.parse(writes[0] ?? '{}')).toMatchObject({
      runId: 'production-sampling-run-1',
      failedCount: 0,
      unconfirmedFixtureCandidateCount: 0,
    });
  });
});
