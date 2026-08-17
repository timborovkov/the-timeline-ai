import {
  type Db,
  agentSuggestions,
  chatMessages,
  dailyDigests,
  documents,
  ingestWebhooks,
  integrations,
  mcpOutboundKeys,
  mcpServers,
  meetings,
  rawEvents,
  slackConversationBindings,
  slackUserTeams,
  slackWorkspaceTeams,
  teamInvites,
  teamMembers,
  teamOnboardingCompletions,
  telegramChatBindings,
  telegramLinkTokens,
  telegramUserTeams,
  userOnboardingDismissals,
} from '@timeline/db';
import { and, count, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { TeamRole } from '#src/team-scope.js';

export const ONBOARDING_STEPS = [
  'first_note',
  'invite_teammate',
  'telegram',
  'slack',
  'email_forwarding',
  'first_document',
  'first_ask',
  'first_meeting',
  'review_proposal',
  'daily_digest',
  'first_integration',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const CAPTURE_EVENT_SOURCES = [
  'web',
  'telegram',
  'email',
  'meeting',
  'integration',
  'calendar',
  'slack',
  'ingest_webhook',
] as const;

const REVIEWED_PROPOSAL_STATUSES = ['accepted', 'rejected'] as const;

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
    activeMembers: number;
    pendingInvites: number;
    userChatMessages: number;
    meetings: number;
    reviewedProposals: number;
    dailyDigests: number;
    ingestWebhooks: number;
    outboundMcpKeys: number;
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
  async function markStepComplete(step: OnboardingStep): Promise<boolean> {
    await ensureMember();
    const inserted = await db
      .insert(teamOnboardingCompletions)
      .values({ teamId, step, completedByUserId: userId })
      .onConflictDoNothing()
      .returning({ step: teamOnboardingCompletions.step });
    return inserted.length > 0;
  }

  return {
    async getChecklistState(): Promise<OnboardingChecklistState> {
      await ensureMember();
      const [
        completions,
        dismissals,
        capturedEvents,
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
        activeMembers,
        pendingInvites,
        userChatMessages,
        scheduledMeetings,
        reviewedProposals,
        digestRows,
        webhookRows,
        outboundKeys,
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
          .where(
            and(eq(rawEvents.teamId, teamId), inArray(rawEvents.source, CAPTURE_EVENT_SOURCES)),
          ),
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
        db
          .select({ total: count() })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt))),
        db
          .select({ total: count() })
          .from(teamInvites)
          .where(
            and(
              eq(teamInvites.teamId, teamId),
              isNull(teamInvites.acceptedAt),
              isNull(teamInvites.revokedAt),
              gt(teamInvites.expiresAt, new Date()),
            ),
          ),
        db
          .select({ total: count() })
          .from(chatMessages)
          .where(and(eq(chatMessages.teamId, teamId), eq(chatMessages.role, 'user'))),
        db.select({ total: count() }).from(meetings).where(eq(meetings.teamId, teamId)),
        db
          .select({ total: count() })
          .from(agentSuggestions)
          .where(
            and(
              eq(agentSuggestions.teamId, teamId),
              inArray(agentSuggestions.status, REVIEWED_PROPOSAL_STATUSES),
            ),
          ),
        db.select({ total: count() }).from(dailyDigests).where(eq(dailyDigests.teamId, teamId)),
        db
          .select({ total: count() })
          .from(ingestWebhooks)
          .where(and(eq(ingestWebhooks.teamId, teamId), isNull(ingestWebhooks.disabledAt))),
        db
          .select({ total: count() })
          .from(mcpOutboundKeys)
          .where(and(eq(mcpOutboundKeys.teamId, teamId), isNull(mcpOutboundKeys.revokedAt))),
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
        activeMembers: firstCount(activeMembers),
        pendingInvites: firstCount(pendingInvites),
        userChatMessages: firstCount(userChatMessages),
        meetings: firstCount(scheduledMeetings),
        reviewedProposals: firstCount(reviewedProposals),
        dailyDigests: firstCount(digestRows),
        ingestWebhooks: firstCount(webhookRows),
        outboundMcpKeys: firstCount(outboundKeys),
      };
      const inferred = new Set<OnboardingStep>();
      if (firstCount(capturedEvents) > 0) inferred.add('first_note');
      if (connectionCounts.activeMembers > 1 || connectionCounts.pendingInvites > 0) {
        inferred.add('invite_teammate');
      }
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
      if (connectionCounts.userChatMessages > 0) inferred.add('first_ask');
      if (connectionCounts.meetings > 0) inferred.add('first_meeting');
      if (connectionCounts.reviewedProposals > 0) inferred.add('review_proposal');
      if (connectionCounts.dailyDigests > 0) inferred.add('daily_digest');
      if (
        connectionCounts.nativeIntegrations +
          connectionCounts.teamMcpServers +
          connectionCounts.ingestWebhooks +
          connectionCounts.outboundMcpKeys >
        0
      ) {
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
