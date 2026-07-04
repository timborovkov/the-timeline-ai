import type { TeamRole, TeamScopeCore } from '#src/team-scope.js';
import type { Db } from '@timeline/db';

import {
  getReconciliationClusterDetail,
  getReconciliationDashboardSnapshot,
  type ReconciliationClusterDetail,
  type ReconciliationDashboardRunHistoryInput,
  type ReconciliationDashboardSnapshot,
} from '#src/reconciliation/dashboard.js';

interface ReconciliationScopeDeps {
  db: Db;
  scope: TeamScopeCore;
}

export function createReconciliationScope(deps: ReconciliationScopeDeps) {
  async function requireAdmin(): Promise<TeamRole> {
    return deps.scope.requireMembership('admin');
  }

  return {
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
