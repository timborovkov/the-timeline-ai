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
      evidencePackSamplePaths: [],
      requiredEvidencePackScenarioFamilies: [],
    });
  });

  it('passes redacted evidence-pack samples and required promotion scenarios', async () => {
    const sample = {
      mode: 'shadow' as const,
      version: 'evidence-pack-v1',
      policyVersion: 'proposal-v1',
      candidateCount: 2,
      selectedCount: 2,
      surfaceCount: 2,
      estimatedTokens: 200,
      buildDurationMs: 50,
      truncated: false,
    };
    const writeReport = vi.fn().mockResolvedValue({
      path: '/tmp/report.json',
      report: {
        runKind: 'closed_beta',
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
    const loadEvidencePackSamples = vi.fn().mockResolvedValue([sample]);

    await runReconciliationProductionSamplingCli(
      parseArgs([
        '--input=/tmp/run',
        '--out=/tmp/report.json',
        '--run-kind=closed_beta',
        '--evidence-pack-samples=/tmp/redacted-pack-samples.json',
        '--required-evidence-scenario=generic_webhook',
      ]),
      { writeReport, loadEvidencePackSamples, write: () => undefined },
    );

    expect(loadEvidencePackSamples).toHaveBeenCalledWith(['/tmp/redacted-pack-samples.json']);
    expect(writeReport).toHaveBeenCalledWith({
      inputPaths: ['/tmp/run'],
      outputPath: '/tmp/report.json',
      runKind: 'closed_beta',
      confirmedFixtureCandidates: [],
      evidencePackSamples: [sample],
      requiredEvidencePackScenarioFamilies: ['generic_webhook'],
    });
  });

  it('requires explicit scenario coverage when promotion samples are supplied', () => {
    expect(() =>
      parseArgs([
        '--input=/tmp/run',
        '--out=/tmp/report.json',
        '--evidence-pack-samples=/tmp/redacted-pack-samples.json',
      ]),
    ).toThrow('require at least one --required-evidence-scenario');
  });

  it('passes an explicitly supplied empty evidence-pack sample set', async () => {
    const writeReport = vi.fn().mockResolvedValue({
      path: '/tmp/report.json',
      report: {
        runKind: 'closed_beta',
        manifestCount: 0,
        sampleCount: 0,
        passedCount: 0,
        failedCount: 0,
        passRate: null,
        fixtureCandidateCount: 0,
        confirmedFixtureCandidateCount: 0,
        unconfirmedFixtureCandidateCount: 0,
        evidencePackPromotion: { ready: false, blockerCodes: ['shadow_sample_floor'] },
      },
      loaded: { ignoredFiles: [] },
    });
    const setExitCode = vi.fn();

    await runReconciliationProductionSamplingCli(
      parseArgs([
        '--input=/tmp/run',
        '--out=/tmp/report.json',
        '--fail-on-failures',
        '--evidence-pack-samples=/tmp/empty-pack-samples.json',
        '--required-evidence-scenario=generic_webhook',
      ]),
      {
        writeReport,
        loadEvidencePackSamples: vi.fn().mockResolvedValue([]),
        write: () => undefined,
        setExitCode,
      },
    );

    expect(writeReport).toHaveBeenCalledWith(expect.objectContaining({ evidencePackSamples: [] }));
    expect(setExitCode).toHaveBeenCalledWith(1);
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

  it('sets exit code when promotion gates are blocked even if eval samples pass', async () => {
    const exitCodes: number[] = [];
    const writeReport = vi.fn().mockResolvedValue({
      path: '/tmp/report.json',
      report: {
        runKind: 'closed_beta',
        manifestCount: 1,
        sampleCount: 1,
        passedCount: 1,
        failedCount: 0,
        passRate: 1,
        fixtureCandidateCount: 0,
        confirmedFixtureCandidateCount: 0,
        unconfirmedFixtureCandidateCount: 0,
        evidencePackPromotion: { ready: false, blockerCodes: ['shadow_sample_floor'] },
      },
      loaded: { ignoredFiles: [] },
    });

    await runReconciliationProductionSamplingCli(
      parseArgs(['--input=/tmp/run', '--out=/tmp/report.json', '--fail-on-failures']),
      {
        writeReport,
        write: () => undefined,
        setExitCode: (code) => exitCodes.push(code),
      },
    );

    expect(exitCodes).toEqual([1]);
  });
});
