import {
  documents,
  documentVersions,
  type integrations,
  type meetingStatus,
  type mcpServers,
} from '@timeline/db';
import { composePostmarkHashAddress } from '@timeline/shared/slug';
import { withTeam } from '@timeline/shared/team-scope';
import { workspaceDueDateBoundaries } from '@timeline/shared/time';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { db } from '@/lib/db';
import { TASK_OPEN_STATUSES_EXCLUDED } from '@/lib/task-board-config';

type TeamScope = ReturnType<typeof withTeam>;
type IntegrationRow = typeof integrations.$inferSelect;
type McpServerRow = typeof mcpServers.$inferSelect;
type MeetingStatus = (typeof meetingStatus.enumValues)[number];
type JobRecoveryItem = jobRecovery.JobRecoveryItem;

export interface WorkAttentionSummary {
  attention: number;
  overdueTasks: number;
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

interface SourcesStatusOptions {
  includeRecoverableJobs?: boolean;
}

export function attentionCount(...counts: number[]): number {
  return counts.reduce((sum, count) => sum + Math.max(0, count), 0);
}

export function displayInboundEmail(
  team: { slug: string; inboundEmail: string | null } | null,
  postmarkInboundAddress: string | undefined,
): string | null {
  if (!team) return null;
  const configuredAddress =
    team.inboundEmail && !team.inboundEmail.endsWith('@inbound.invalid') ? team.inboundEmail : null;
  return configuredAddress ?? composePostmarkHashAddress(team.slug, postmarkInboundAddress);
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

/** Home shows approvals separately, so work attention is overdue tasks only. */
export function homeWorkNeedingAttentionCount(summary: WorkAttentionSummary): number {
  return Math.max(0, summary.overdueTasks);
}

export const HOME_OPEN_OBJECT_TYPES = [
  'task',
  'follow_up',
  'person',
  'company',
  'project',
  'deal',
] as const;

export type HomeOpenObjectType = (typeof HOME_OPEN_OBJECT_TYPES)[number];
export type HomeOpenObjectCounts = Record<HomeOpenObjectType, number>;

export function homeOpenObjectHref(type: HomeOpenObjectType): string {
  return type === 'task' ? '/app/tasks' : `/app/objects?type=${type}`;
}

export async function getHomeOpenObjectCounts(scope: TeamScope): Promise<HomeOpenObjectCounts> {
  const entries = await Promise.all(
    HOME_OPEN_OBJECT_TYPES.map(async (type) => {
      const count = await scope.objects.countObjects({
        type,
        archived: false,
        statusNotCaseInsensitive: [...TASK_OPEN_STATUSES_EXCLUDED],
      });
      return [type, count] as const;
    }),
  );
  return Object.fromEntries(entries) as HomeOpenObjectCounts;
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

export function countDismissibleMeetingFailures(items: JobRecoveryItem[]): number {
  return items.filter((item) => item.kind === 'meeting_finalization' && item.status === 'failed')
    .length;
}

export function countMeetingFailuresForSources(input: {
  includeRecoverableJobs: boolean;
  recoverableJobs: JobRecoveryItem[];
}): number {
  if (input.includeRecoverableJobs) {
    return countDismissibleMeetingFailures(input.recoverableJobs);
  }
  return 0;
}

async function listAdminRecoverableJobs(scope: TeamScope): Promise<JobRecoveryItem[]> {
  try {
    await scope.requireMembership('admin');
  } catch {
    return [];
  }
  return scope.jobRecovery.listRecoverableJobs();
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

export async function getWorkAttentionSummary(
  scope: TeamScope,
  now = new Date(),
  timezone?: string,
): Promise<WorkAttentionSummary> {
  const resolvedTimezone = timezone ?? (await scope.calendar.getCalendarSettings()).defaultTimezone;
  const boundaries = workspaceDueDateBoundaries(resolvedTimezone, now);
  const [approvalCounts, overdueTasks] = await Promise.all([
    scope.suggestions.getApprovalItemCounts(),
    scope.objects.countObjects({
      type: 'task',
      archived: false,
      statusNotCaseInsensitive: [...TASK_OPEN_STATUSES_EXCLUDED],
      dueDateRange: { timezone: resolvedTimezone, to: boundaries.today },
    }),
  ]);
  return {
    attention: workAttentionCount({
      pendingApprovals: approvalCounts.pending,
      overdueTasks,
    }),
    overdueTasks,
    pendingApprovals: approvalCounts.pending,
  };
}

export async function getNavWorkAttention(scope: TeamScope, now = new Date()): Promise<number> {
  return (await getWorkAttentionSummary(scope, now)).attention;
}

export async function getSourcesStatusSummary(
  scope: TeamScope,
  options: SourcesStatusOptions = {},
): Promise<SourcesStatusSummary> {
  const includeRecoverableJobs = options.includeRecoverableJobs ?? true;
  const [
    onboarding,
    team,
    documentsTotal,
    documentAttention,
    meetings,
    recoverableJobs,
    meetingMinutesUsed,
    integrations,
    mcpServerRows,
  ] = await Promise.all([
    scope.onboarding.getChecklistState(),
    scope.timeline.team(),
    countVisibleDocuments(scope.teamId, scope.userId),
    countVisibleDocumentAttention(scope.teamId, scope.userId),
    scope.meetings.listMeetings({ limit: 50 }),
    includeRecoverableJobs ? listAdminRecoverableJobs(scope) : Promise.resolve([]),
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
  const meetingsFailed = countMeetingFailuresForSources({
    includeRecoverableJobs,
    recoverableJobs,
  });
  const meetingsActive = countMeetingsByStatus(meetings, [
    'pending',
    'joining',
    'active',
    'processing',
  ]);
  const integrationErrors = countIntegrationErrors(integrations);
  const mcpErrors = countMcpErrors(mcpServerRows);
  const inboundEmail = displayInboundEmail(team, process.env.POSTMARK_INBOUND_ADDRESS);
  const emailAttention =
    inboundEmail &&
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
    inboundEmail,
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
    getNavWorkAttention(scope),
    getSourcesStatusSummary(scope, { includeRecoverableJobs: false }),
  ]);
  return { work, connections: sources.attention };
}
