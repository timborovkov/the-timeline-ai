import {
  boards,
  calendarEvents,
  documents,
  documentVersions,
  entities,
  type integrations,
  type meetingStatus,
  type mcpServers,
} from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';

type TeamScope = ReturnType<typeof withTeam>;
type IntegrationRow = typeof integrations.$inferSelect;
type McpServerRow = typeof mcpServers.$inferSelect;
type MeetingStatus = (typeof meetingStatus.enumValues)[number];

interface WorkStatusSummary {
  attention: number;
  objectsTotal: number;
  tasksOpen: number;
  tasksOverdue: number;
  boardsTotal: number;
  upcomingCalendarEvents: number;
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
  connections: number;
}

export function attentionCount(...counts: number[]): number {
  return counts.reduce((sum, count) => sum + Math.max(0, count), 0);
}

export function workAttentionCount({
  pendingApprovals,
  overdueTasks,
}: {
  pendingApprovals: number;
  overdueTasks: number;
}): number {
  return attentionCount(pendingApprovals, overdueTasks);
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

async function countTeamRows(conditions: Parameters<typeof and>): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(entities)
    .where(and(...conditions));
  return rows[0]?.total ?? 0;
}

async function getWorkInventoryCounts(teamId: string, userId: string, now: Date, inTwoWeeks: Date) {
  const nowIso = now.toISOString();
  const inTwoWeeksIso = inTwoWeeks.toISOString();
  const activeObjectConditions = [
    eq(entities.teamId, teamId),
    isNull(entities.mergedIntoId),
    isNull(entities.archivedAt),
  ];
  const openTaskConditions = [
    ...activeObjectConditions,
    eq(entities.type, 'task'),
    ne(entities.status, 'done'),
    ne(entities.status, 'cancelled'),
  ];
  const calendarReadVisibility = sql`(
    ${calendarEvents.visibility} = 'team'
    OR ${calendarEvents.visibility} = 'private'
    OR ${calendarEvents.createdByUserId} = ${userId}::uuid
    OR (${calendarEvents.visibility} = 'specific_users' AND ${userId}::uuid = ANY(${calendarEvents.visibilityUserIds}))
  )`;

  const [objectsTotal, tasksOpen, tasksOverdue, boardsTotal, upcomingRows] = await Promise.all([
    countTeamRows(activeObjectConditions),
    countTeamRows(openTaskConditions),
    countTeamRows([...openTaskConditions, lt(entities.dueAt, now)]),
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(boards)
      .where(and(eq(boards.teamId, teamId), isNull(boards.archivedAt))),
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          calendarReadVisibility,
          isNull(calendarEvents.deletedAt),
          sql`${calendarEvents.endAt} >= ${nowIso}::timestamptz`,
          sql`${calendarEvents.startAt} < ${inTwoWeeksIso}::timestamptz`,
        ),
      ),
  ]);

  return {
    objectsTotal,
    tasksOpen,
    tasksOverdue,
    boardsTotal: boardsTotal[0]?.total ?? 0,
    upcomingCalendarEvents: upcomingRows[0]?.total ?? 0,
  };
}

async function getWorkStatusSummary(scope: TeamScope): Promise<WorkStatusSummary> {
  const now = new Date();
  const inTwoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  await scope.requireMembership();
  const [inventory, pendingApprovals] = await Promise.all([
    getWorkInventoryCounts(scope.teamId, scope.userId, now, inTwoWeeks),
    scope.suggestions.countPendingSuggestions(),
  ]);

  return {
    attention: workAttentionCount({
      pendingApprovals,
      overdueTasks: inventory.tasksOverdue,
    }),
    objectsTotal: inventory.objectsTotal,
    tasksOpen: inventory.tasksOpen,
    tasksOverdue: inventory.tasksOverdue,
    boardsTotal: inventory.boardsTotal,
    upcomingCalendarEvents: inventory.upcomingCalendarEvents,
    pendingApprovals,
  };
}

export async function getSourcesStatusSummary(scope: TeamScope): Promise<SourcesStatusSummary> {
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
    countVisibleDocuments(scope.teamId, scope.userId),
    countVisibleDocumentAttention(scope.teamId, scope.userId),
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
  const emailAttention =
    team?.inboundEmail &&
    !onboarding.steps.some((step) => step.step === 'email_forwarding' && step.completed)
      ? 1
      : 0;

  return {
    attention: attentionCount(
      documentAttention,
      meetingsFailed,
      integrationErrors,
      mcpErrors,
      emailAttention,
    ),
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
    mcpServers: mcpServerRows.length,
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
    getSourcesStatusSummary(scope),
  ]);
  return { work: work.attention, connections: sources.attention };
}
