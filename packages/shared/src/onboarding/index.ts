import {
  type Db,
  documents,
  integrations,
  mcpServers,
  rawEvents,
  slackConversationBindings,
  slackUserTeams,
  slackWorkspaceTeams,
  teamOnboardingCompletions,
  telegramChatBindings,
  telegramLinkTokens,
  telegramUserTeams,
  userOnboardingDismissals,
} from '@timeline/db';
import { and, count, eq, isNull } from 'drizzle-orm';

import type { TeamRole } from '#src/team-scope.js';

export const ONBOARDING_STEPS = [
  'first_note',
  'telegram',
  'slack',
  'email_forwarding',
  'first_document',
  'first_integration',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStepState {
  step: OnboardingStep;
  completed: boolean;
  completedAt: Date | null;
  completedByUserId: string | null;
}

export interface OnboardingChecklistState {
  dismissed: boolean;
  steps: OnboardingStepState[];
  connectionCounts: {
    telegramLinkTokens: number;
    telegramChatBindings: number;
    telegramUserTeams: number;
    slackWorkspaceTeams: number;
    slackConversationBindings: number;
    slackUserTeams: number;
    nativeIntegrations: number;
    teamMcpServers: number;
  };
}

interface OnboardingScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: TeamRole) => Promise<TeamRole>;
}

function firstCount(rows: { total: number }[]): number {
  return rows[0]?.total ?? 0;
}

export function createOnboardingScope({ db, teamId, userId, ensureMember }: OnboardingScopeDeps) {
  async function markStepComplete(step: OnboardingStep): Promise<void> {
    await ensureMember();
    await db
      .insert(teamOnboardingCompletions)
      .values({ teamId, step, completedByUserId: userId })
      .onConflictDoNothing();
  }

  return {
    async getChecklistState(): Promise<OnboardingChecklistState> {
      await ensureMember();
      const [
        completions,
        dismissals,
        webEvents,
        emailEvents,
        telegramLinks,
        telegramBindings,
        telegramUsers,
        slackInstalls,
        slackBindings,
        slackUsers,
        uploadedDocuments,
        nativeIntegrations,
        teamMcpServers,
      ] = await Promise.all([
        db
          .select()
          .from(teamOnboardingCompletions)
          .where(eq(teamOnboardingCompletions.teamId, teamId)),
        db
          .select()
          .from(userOnboardingDismissals)
          .where(
            and(
              eq(userOnboardingDismissals.teamId, teamId),
              eq(userOnboardingDismissals.userId, userId),
            ),
          )
          .limit(1),
        db
          .select({ total: count() })
          .from(rawEvents)
          .where(and(eq(rawEvents.teamId, teamId), eq(rawEvents.source, 'web'))),
        db
          .select({ total: count() })
          .from(rawEvents)
          .where(and(eq(rawEvents.teamId, teamId), eq(rawEvents.source, 'email'))),
        db
          .select({ total: count() })
          .from(telegramLinkTokens)
          .where(eq(telegramLinkTokens.teamId, teamId)),
        db
          .select({ total: count() })
          .from(telegramChatBindings)
          .where(eq(telegramChatBindings.teamId, teamId)),
        db
          .select({ total: count() })
          .from(telegramUserTeams)
          .where(eq(telegramUserTeams.teamId, teamId)),
        db
          .select({ total: count() })
          .from(slackWorkspaceTeams)
          .where(
            and(eq(slackWorkspaceTeams.teamId, teamId), eq(slackWorkspaceTeams.enabled, true)),
          ),
        db
          .select({ total: count() })
          .from(slackConversationBindings)
          .where(
            and(
              eq(slackConversationBindings.teamId, teamId),
              eq(slackConversationBindings.enabled, true),
            ),
          ),
        db.select({ total: count() }).from(slackUserTeams).where(eq(slackUserTeams.teamId, teamId)),
        db
          .select({ total: count() })
          .from(documents)
          .where(and(eq(documents.teamId, teamId), isNull(documents.deletedAt))),
        db.select({ total: count() }).from(integrations).where(eq(integrations.teamId, teamId)),
        db
          .select({ total: count() })
          .from(mcpServers)
          .where(and(eq(mcpServers.teamId, teamId), isNull(mcpServers.userId))),
      ]);

      const explicit = new Map(completions.map((row) => [row.step, row] as const));
      const connectionCounts = {
        telegramLinkTokens: firstCount(telegramLinks),
        telegramChatBindings: firstCount(telegramBindings),
        telegramUserTeams: firstCount(telegramUsers),
        slackWorkspaceTeams: firstCount(slackInstalls),
        slackConversationBindings: firstCount(slackBindings),
        slackUserTeams: firstCount(slackUsers),
        nativeIntegrations: firstCount(nativeIntegrations),
        teamMcpServers: firstCount(teamMcpServers),
      };
      const inferred = new Set<OnboardingStep>();
      if (firstCount(webEvents) > 0) inferred.add('first_note');
      if (
        connectionCounts.telegramLinkTokens +
          connectionCounts.telegramChatBindings +
          connectionCounts.telegramUserTeams >
        0
      ) {
        inferred.add('telegram');
      }
      if (
        connectionCounts.slackWorkspaceTeams +
          connectionCounts.slackConversationBindings +
          connectionCounts.slackUserTeams >
        0
      ) {
        inferred.add('slack');
      }
      if (firstCount(emailEvents) > 0) inferred.add('email_forwarding');
      if (firstCount(uploadedDocuments) > 0) inferred.add('first_document');
      if (connectionCounts.nativeIntegrations + connectionCounts.teamMcpServers > 0) {
        inferred.add('first_integration');
      }

      return {
        dismissed: dismissals.length > 0,
        connectionCounts,
        steps: ONBOARDING_STEPS.map((step) => {
          const row = explicit.get(step);
          return {
            step,
            completed: Boolean(row) || inferred.has(step),
            completedAt: row?.completedAt ?? null,
            completedByUserId: row?.completedByUserId ?? null,
          };
        }),
      };
    },

    markStepComplete,

    async dismissChecklist(): Promise<void> {
      await ensureMember();
      await db
        .insert(userOnboardingDismissals)
        .values({ teamId, userId })
        .onConflictDoUpdate({
          target: [userOnboardingDismissals.teamId, userOnboardingDismissals.userId],
          set: { dismissedAt: new Date() },
        });
    },

    async reopenChecklist(): Promise<void> {
      await ensureMember();
      await db
        .delete(userOnboardingDismissals)
        .where(
          and(
            eq(userOnboardingDismissals.teamId, teamId),
            eq(userOnboardingDismissals.userId, userId),
          ),
        );
    },
  };
}
