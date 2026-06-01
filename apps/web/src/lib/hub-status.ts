import {
  documents,
  documentVersions,
  type integrations,
  type meetingStatus,
  type mcpServers,
} from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';

type TeamScope = ReturnType<typeof withTeam>;
type IntegrationRow = typeof integrations.$inferSelect;
type McpServerRow = typeof mcpServers.$inferSelect;
type MeetingStatus = (typeof meetingStatus.enumValues)[number];

export interface WorkStatusSummary {
  attention: number;
  objectsTotal: number;
  tasksOpen: number;
  tasksOverdue: number;
  boardsTotal: number;
  upcomingCalendarEvents: number;
  unreadNotifications: number;
  pendingApprovals: number;
}

export interface SourcesStatusSummary {
  attention: number;
  inboundEmail: string | null;
  emailForwarded: boolean;
  telegramConnections: number;
  slackConnections: number;
  documentsTotal: number;
  documentAttention: number;
  meetingsRecent: number;
  meetingsActive: number;
  meetingsFailed: number;
  meetingMinutesUsed: number;
  nativeIntegrations: number;
  integrationErrors: number;
  mcpServers: number;
  mcpErrors: number;
}

interface NavAttentionSummary {
  work: number;
  sources: number;
}

export function attentionCount(...counts: number[]): number {
  return counts.reduce((sum, count) => sum + Math.max(0, count), 0);
}

function isOpenTask(status: string | null): boolean {
  return status !== 'done' && status !== 'cancelled';
}

function countIntegrationErrors(rows: IntegrationRow[]): number {
  return rows.filter((row) => row.lastError).length;
}

function countMcpErrors(rows: McpServerRow[]): number {
  return rows.filter((row) => row.lastError).length;
}

function countMeetingsByStatus(
  rows: { status: MeetingStatus }[],
  statuses: readonly MeetingStatus[],
): number {
  const statusSet = new Set(statuses);
  return rows.filter((row) => statusSet.has(row.status)).length;
}

async function countVisibleDocumentAttention(teamId: string, userId: string): Promise<number> {
  const pendingCutoff = new Date(Date.now() - 30 * 60 * 1000);
  const extractingCutoff = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.teamId, teamId),
        isNull(documents.deletedAt),
        or(
          eq(documents.visibility, 'team'),
          and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
          and(
            eq(documents.visibility, 'specific_users'),
            sql`${userId}::uuid = ANY(COALESCE(${documents.visibilityUserIds}, ARRAY[]::uuid[]))`,
          ),
        ),
        or(
          eq(documentVersions.processingStatus, 'failed'),
          and(
            eq(documentVersions.processingStatus, 'pending'),
            sql`${documentVersions.byteSize} IS NOT NULL`,
            lt(documentVersions.createdAt, pendingCutoff),
          ),
          and(
            eq(documentVersions.processingStatus, 'extracting'),
            lt(documentVersions.createdAt, extractingCutoff),
          ),
        ),
      ),
    );
  return rows[0]?.total ?? 0;
}

async function countVisibleDocuments(teamId: string, userId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.teamId, teamId),
        isNull(documents.deletedAt),
        or(
          eq(documents.visibility, 'team'),
          and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
          and(
            eq(documents.visibility, 'specific_users'),
            sql`${userId}::uuid = ANY(COALESCE(${documents.visibilityUserIds}, ARRAY[]::uuid[]))`,
          ),
        ),
      ),
    );
  return rows[0]?.total ?? 0;
}

export async function getWorkStatusSummary(scope: TeamScope): Promise<WorkStatusSummary> {
  const now = new Date();
  const inTwoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [objects, tasks, boards, calendarEvents, unreadNotifications, pendingApprovals] =
    await Promise.all([
      scope.objects.listObjects({ archived: false, limit: 500 }),
      scope.objects.listObjects({ type: 'task', archived: false, limit: 500 }),
      scope.objects.listBoardViews(),
      scope.calendar.listCalendarEvents({ from: now, to: inTwoWeeks, limit: 100 }),
      scope.objects.unreadNotificationCount(),
      scope.suggestions.countPendingSuggestions(),
    ]);

  const openTasks = tasks.filter((task) => isOpenTask(task.status));
  const overdueTasks = openTasks.filter((task) => task.dueAt !== null && task.dueAt < now);

  return {
    attention: attentionCount(pendingApprovals, unreadNotifications, overdueTasks.length),
    objectsTotal: objects.length,
    tasksOpen: openTasks.length,
    tasksOverdue: overdueTasks.length,
    boardsTotal: boards.length,
    upcomingCalendarEvents: calendarEvents.length,
    unreadNotifications,
    pendingApprovals,
  };
}

export async function getSourcesStatusSummary(
  scope: TeamScope,
  teamId: string,
  userId: string,
): Promise<SourcesStatusSummary> {
  const [
    onboarding,
    team,
    documentsTotal,
    documentAttention,
    meetings,
    meetingMinutesUsed,
    integrations,
    mcpServerRows,
  ] = await Promise.all([
    scope.onboarding.getChecklistState(),
    scope.timeline.team(),
    countVisibleDocuments(teamId, userId),
    countVisibleDocumentAttention(teamId, userId),
    scope.meetings.listMeetings({ limit: 50 }),
    scope.meetings.getCurrentMonthMinutes(),
    scope.integrations.listIntegrations(),
    scope.mcp.listServers(),
  ]);

  const telegramConnections =
    onboarding.connectionCounts.telegramChatBindings +
    onboarding.connectionCounts.telegramUserTeams;
  const slackConnections =
    onboarding.connectionCounts.slackWorkspaceTeams +
    onboarding.connectionCounts.slackConversationBindings +
    onboarding.connectionCounts.slackUserTeams;
  const meetingsFailed = countMeetingsByStatus(meetings, ['failed']);
  const meetingsActive = countMeetingsByStatus(meetings, [
    'pending',
    'joining',
    'active',
    'processing',
  ]);
  const integrationErrors = countIntegrationErrors(integrations);
  const mcpErrors = countMcpErrors(mcpServerRows);

  return {
    attention: attentionCount(documentAttention, meetingsFailed, integrationErrors, mcpErrors),
    inboundEmail: team?.inboundEmail ?? null,
    emailForwarded: onboarding.steps.some(
      (step) => step.step === 'email_forwarding' && step.completed,
    ),
    telegramConnections,
    slackConnections,
    documentsTotal,
    documentAttention,
    meetingsRecent: meetings.length,
    meetingsActive,
    meetingsFailed,
    meetingMinutesUsed,
    nativeIntegrations: onboarding.connectionCounts.nativeIntegrations,
    integrationErrors,
    mcpServers: onboarding.connectionCounts.teamMcpServers,
    mcpErrors,
  };
}

export async function getNavAttentionSummary(
  teamId: string,
  userId: string,
): Promise<NavAttentionSummary> {
  const scope = withTeam(db, teamId, userId);
  const [work, sources] = await Promise.all([
    getWorkStatusSummary(scope),
    getSourcesStatusSummary(scope, teamId, userId),
  ]);
  return { work: work.attention, sources: sources.attention };
}
