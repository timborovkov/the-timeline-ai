import { describe, expect, it, vi } from 'vitest';

import {
  parseArgs,
  ReconciliationLegacyProvenanceUsageError,
  runReconciliationLegacyProvenanceCli,
} from '#src/scripts/reconciliation-legacy-provenance.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';

describe('reconciliation legacy provenance CLI', () => {
  it('parses required team and fail flag', () => {
    expect(parseArgs([`--team=${TEAM_ID}`, '--fail-on-legacy'])).toEqual({
      teamId: TEAM_ID,
      failOnLegacy: true,
    });
  });

  it('rejects missing or unknown arguments', () => {
    expect(() => parseArgs([])).toThrow(ReconciliationLegacyProvenanceUsageError);
    expect(() => parseArgs([`--team=${TEAM_ID}`, '--wat'])).toThrow(
      ReconciliationLegacyProvenanceUsageError,
    );
  });

  it('prints cutover counts and fails when legacy rows remain', async () => {
    const write = vi.fn<(message: string) => void>();
    const setExitCode = vi.fn();
    const audit = vi.fn().mockResolvedValue({
      objectSourceEventRows: 1,
      objectAgentSuggestedRows: 0,
      objectChangeSourceEventRows: 2,
      boardHistorySourceEventRows: 0,
      totalRows: 3,
    });

    await runReconciliationLegacyProvenanceCli(
      { teamId: TEAM_ID, failOnLegacy: true },
      {
        db: {} as never,
        audit,
        write,
        setExitCode,
      },
    );

    expect(audit).toHaveBeenCalledWith({ db: {}, teamId: TEAM_ID });
    const output = write.mock.calls[0]?.[0];
    if (typeof output !== 'string') throw new Error('expected JSON output');
    expect(JSON.parse(output)).toEqual({
      mode: 'legacy_provenance_cutover',
      teamId: TEAM_ID,
      report: {
        objectSourceEventRows: 1,
        objectAgentSuggestedRows: 0,
        objectChangeSourceEventRows: 2,
        boardHistorySourceEventRows: 0,
        totalRows: 3,
      },
    });
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('does not fail the gate when legacy rows are gone', async () => {
    const setExitCode = vi.fn();

    await runReconciliationLegacyProvenanceCli(
      { teamId: TEAM_ID, failOnLegacy: true },
      {
        db: {} as never,
        audit: vi.fn().mockResolvedValue({
          objectSourceEventRows: 0,
          objectAgentSuggestedRows: 0,
          objectChangeSourceEventRows: 0,
          boardHistorySourceEventRows: 0,
          totalRows: 0,
        }),
        write: vi.fn(),
        setExitCode,
      },
    );

    expect(setExitCode).not.toHaveBeenCalled();
  });
});
