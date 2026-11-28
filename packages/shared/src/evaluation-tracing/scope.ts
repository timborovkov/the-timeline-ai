import { randomUUID } from 'node:crypto';

import { auditLog, teams, teamMembers, evaluationTraceProjects, type Db } from '@timeline/db';
import type { TeamRole } from '@timeline/db/contracts/workspace-access';
import { and, eq, isNull } from 'drizzle-orm';

import { getEnv } from '#src/env.js';
import {
  evaluationPreferenceInput,
  EVALUATION_CONSENT_VERSION,
} from '#src/evaluation-tracing/contract.js';
import { createEvaluationCaptureScope } from '#src/evaluation-tracing/runtime.js';

export function createEvaluationTracingScope({
  db,
  teamId,
  userId,
  ensureMember,
}: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: TeamRole) => Promise<unknown>;
}) {
  async function settings() {
    await ensureMember();
    const [team] = await db
      .select({ preference: teams.evaluationTracing })
      .from(teams)
      .where(eq(teams.id, teamId));
    const env = getEnv();
    return {
      preference: team?.preference ?? {
        enabled: false,
        sources: [],
        revision: '0',
        policyVersion: '',
      },
      available: Boolean(
        env.WORKSPACE_EVALUATION_TRACING_READY &&
        env.LANGSMITH_API_KEY &&
        env.LANGSMITH_WORKSPACE_ID,
      ),
    };
  }
  async function configure(input: unknown) {
    const value = evaluationPreferenceInput.parse(input);
    await ensureMember('admin');
    await db.transaction(async (tx) => {
      const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for('update');
      const [member] = await tx
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId),
            isNull(teamMembers.removedAt),
          ),
        )
        .for('update');
      if (
        !team ||
        team.disabledAt ||
        team.deletionStartedAt ||
        !member ||
        !['owner', 'admin'].includes(member.role)
      )
        throw new Error('Current workspace administrator required');
      await tx
        .update(teams)
        .set({
          evaluationTracing: {
            enabled: value.enabled,
            sources: [...new Set(value.sources)],
            revision: randomUUID(),
            policyVersion: EVALUATION_CONSENT_VERSION,
          },
        })
        .where(eq(teams.id, teamId));
      // Changing permission also schedules removal of previously collected traces.
      await tx
        .update(evaluationTraceProjects)
        .set({ expiresAt: new Date() })
        .where(eq(evaluationTraceProjects.teamId, teamId));
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'evaluation_tracing.updated',
        targetType: 'team',
        targetId: teamId,
        metadata: {
          enabled: value.enabled,
          sources: value.sources,
          consentVersion: EVALUATION_CONSENT_VERSION,
        },
      });
    });
  }
  return { settings, configure, ...createEvaluationCaptureScope(db, teamId, ensureMember) };
}
