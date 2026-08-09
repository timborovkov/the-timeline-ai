import { reconciliationRuns, type Db } from '@timeline/db';

import type { TeamRole, TeamScopeCore } from '#src/team-scope.js';

import {
  getReconciliationClusterDetail,
  getReconciliationDashboardSnapshot,
  type ReconciliationClusterDetail,
  type ReconciliationDashboardRunHistoryInput,
  type ReconciliationDashboardSnapshot,
} from '#src/reconciliation/dashboard.js';
import {
  PRODUCTION_SAMPLING_RUN_ENGINE_VERSION,
  productionSamplingRunFingerprint,
  productionSamplingRunMetrics,
  type RecordProductionSamplingEvalReportInput,
} from '#src/reconciliation/production-sampling.js';

interface ReconciliationScopeDeps {
  db: Db;
  scope: TeamScopeCore;
}

export function createReconciliationScope(deps: ReconciliationScopeDeps) {
  async function requireAdmin(): Promise<TeamRole> {
    return deps.scope.requireMembership('admin');
  }

  return {
    async recordProductionSamplingEvalReport(
      input: RecordProductionSamplingEvalReportInput,
    ): Promise<string> {
      await deps.scope.requireMembership();
      const generatedAt = new Date(input.report.generatedAt);
      const completedAt = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt;
      const metrics = productionSamplingRunMetrics(input);
      const [run] = await deps.db
        .insert(reconciliationRuns)
        .values({
          teamId: deps.scope.teamId,
          trigger: 'eval',
          scope: `production_sampling:${input.report.runKind}`,
          status: 'completed',
          inputFingerprint: productionSamplingRunFingerprint(deps.scope.teamId, input.report),
          engineVersion: PRODUCTION_SAMPLING_RUN_ENGINE_VERSION,
          modelVersions: input.report.modelVersions,
          startedAt: completedAt,
          completedAt,
          metrics,
        })
        .onConflictDoUpdate({
          target: [
            reconciliationRuns.teamId,
            reconciliationRuns.inputFingerprint,
            reconciliationRuns.engineVersion,
          ],
          set: {
            status: 'completed',
            startedAt: completedAt,
            completedAt,
            errorCode: null,
            modelVersions: input.report.modelVersions,
            metrics,
          },
        })
        .returning({ id: reconciliationRuns.id });
      if (!run) throw new Error('Failed to record production sampling reconciliation run');
      return run.id;
    },
    async getDashboardSnapshot(
      input: { rawEventLimit?: number; runHistory?: ReconciliationDashboardRunHistoryInput } = {},
    ): Promise<ReconciliationDashboardSnapshot> {
      await requireAdmin();
      const snapshotInput = {
        db: deps.db,
        teamId: deps.scope.teamId,
        viewerUserId: deps.scope.userId,
        ...(input.rawEventLimit === undefined ? {} : { rawEventLimit: input.rawEventLimit }),
        ...(input.runHistory === undefined ? {} : { runHistory: input.runHistory }),
      };
      return getReconciliationDashboardSnapshot(snapshotInput);
    },
    async getClusterDetail(input: {
      clusterId: string;
    }): Promise<ReconciliationClusterDetail | null> {
      await requireAdmin();
      return getReconciliationClusterDetail({
        db: deps.db,
        teamId: deps.scope.teamId,
        viewerUserId: deps.scope.userId,
        clusterId: input.clusterId,
      });
    },
  };
}
