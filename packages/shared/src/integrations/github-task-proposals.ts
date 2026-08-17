import {
  agentSuggestionItems,
  agentSuggestions,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  integrations,
  providerConnections,
  rawEvents,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { IntegrationEvent, ObjectMapping } from '#src/integrations/types.js';

import { GITHUB_TASK_PROPOSAL_COALESCE_MS } from '#src/integrations/ingest-processing.js';
import {
  isSignalClass,
  objectMapFromUnknown,
  resolveSignalClass,
} from '#src/integrations/signal-class.js';
import { childLogger } from '#src/logger.js';
import { enqueueSuggestionJob } from '#src/queue/queues.js';
import { suggestionDedupeKey } from '#src/suggestions/dedupe-key.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('integrations:github-task-proposals');
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const OPEN_TASK_STATUSES_EXCLUDED = ['done', 'cancelled', 'canceled', 'shipped'] as const;
const TASK_CANDIDATE_LIMIT = 500;
const PENDING_CREATE_LIMIT = 200;
const CLUSTER_SCAN_LIMIT = 200;
const GITHUB_DISPLAY_NAME_LOGIN = /^GitHub\s+[—–-]\s+(\S+)$/u;
const GITHUB_PULL_REQUEST_EVENT_TYPES = new Set([
  'pr.merged',
  'pr.closed',
  'pr.updated',
  'pr.opened',
  'pull_request.opened',
  'pull_request.closed',
  'pull_request.merged',
]);
const GITHUB_ISSUE_EVENT_TYPES = new Set([
  'issue.closed',
  'issue.updated',
  'issue.reopened',
  'issue.opened',
]);

export interface GithubWorkItem {
  repo: string;
  number: number;
  kind: 'pull_request' | 'issue';
  title: string;
  externalId: string;
  status: 'open' | 'done' | 'cancelled';
  eventType: string;
  url: string | null;
  aliases: string[];
  actorLogin: string | null;
  assigneeLogins: string[];
}

export interface GithubTaskProposalPlan {
  taskId: string;
  taskName: string;
  status: 'done' | null;
  assigneeUserId: string | null;
  ownerUserId: string | null;
  aliases: string[];
  match: 'provider_id' | 'alias' | 'title';
}

export interface CapturedWorkItem {
  provider: string;
  externalId: string;
  title: string;
  status: 'open' | 'done' | 'cancelled';
  eventType: string;
  url: string | null;
  aliases: string[];
  actorLogin: string | null;
  assigneeLogins: string[];
  github: GithubWorkItem | null;
}

interface OpenTaskRow {
  id: string;
  canonicalName: string;
  aliases: unknown;
  metadata: unknown;
  status: string;
  ownerUserId: string | null;
  assigneeUserId: string | null;
}

interface GithubProposalSource {
  workItem: CapturedWorkItem;
  rawEventId: string;
  contentText: string;
  canonicalEntityId?: string | null;
}

interface PendingTaskCreate {
  suggestionId: string;
  suggestionDedupeKey: string;
  itemDedupeKey: string;
  targetKind: 'task' | 'object';
  title: string;
  editedByUser: boolean;
  task: OpenTaskRow;
  payload: Record<string, unknown>;
}

export function githubLoginFromConnectionDisplayName(displayName: string): string | null {
  const match = GITHUB_DISPLAY_NAME_LOGIN.exec(displayName.trim());
  const login = match?.[1]?.trim();
  return login && login.length > 0 ? login : null;
}

export function compactGithubPersonKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function resolveGithubLoginToUserId(
  login: string,
  members: readonly { userId: string; name: string | null; email?: string | null }[],
  githubLoginsByUserId: ReadonlyMap<string, readonly string[]>,
): string | null {
  const needle = login.trim().toLowerCase();
  if (!needle) return null;
  const connectionMatches = [...githubLoginsByUserId.entries()]
    .filter(([, logins]) => logins.some((candidate) => candidate.toLowerCase() === needle))
    .map(([userId]) => userId);
  const uniqueConnections = [...new Set(connectionMatches)];
  if (uniqueConnections.length === 1) return uniqueConnections[0] ?? null;
  if (uniqueConnections.length > 1) return null;

  const compact = compactGithubPersonKey(login);
  if (!compact) return null;
  const nameMatches = members.filter(
    (member) => member.name !== null && compactGithubPersonKey(member.name) === compact,
  );
  const emailMatches = members.filter((member) => {
    const local = member.email?.split('@')[0];
    return Boolean(local) && compactGithubPersonKey(local ?? '') === compact;
  });
  const uniqueName = nameMatches.length === 1 ? (nameMatches[0]?.userId ?? null) : null;
  const uniqueEmail = emailMatches.length === 1 ? (emailMatches[0]?.userId ?? null) : null;
  if (uniqueName && uniqueEmail && uniqueName !== uniqueEmail) return null;
  return uniqueName ?? uniqueEmail;
}

export function githubWorkItemFromIntegrationEvent(event: IntegrationEvent): GithubWorkItem | null {
  if (event.provider !== 'github') return null;
  return githubWorkItemFromParts({
    eventType: event.eventType,
    externalObjectId: event.externalObjectId,
    contentText: event.contentText,
    actor: event.actor ?? null,
    extra: event.extra ?? {},
    objectMap: event.objectMap ?? null,
  });
}

export function githubWorkItemFromRawMetadata(
  sourceMetadata: unknown,
  contentText: string | null,
): GithubWorkItem | null {
  const metadata = recordFromUnknown(sourceMetadata);
  const provider = stringValue(metadata.provider);
  if (provider !== 'github') return null;
  return githubWorkItemFromParts({
    eventType: stringValue(metadata.event_type) ?? '',
    externalObjectId:
      stringValue(metadata.external_object_id) ?? stringValue(metadata.externalObjectId),
    contentText: contentText ?? '',
    actor: recordFromUnknown(metadata.actor),
    extra: metadata,
    objectMap: objectMapFromUnknown(metadata.object_map),
  });
}

function capturedWorkItemFromGithub(workItem: GithubWorkItem): CapturedWorkItem {
  return {
    provider: 'github',
    externalId: workItem.externalId,
    title: workItem.title,
    status: workItem.status,
    eventType: workItem.eventType,
    url: workItem.url,
    aliases: workItemAliases(workItem),
    actorLogin: workItem.actorLogin,
    assigneeLogins: workItem.assigneeLogins,
    github: workItem,
  };
}

export function capturedWorkItemFromIntegrationEvent(
  event: IntegrationEvent,
): CapturedWorkItem | null {
  const github = githubWorkItemFromIntegrationEvent(event);
  if (github) return capturedWorkItemFromGithub(github);
  return capturedWorkItemFromObjectMap({
    provider: event.provider,
    eventType: event.eventType,
    contentText: event.contentText,
    actor: event.actor ?? null,
    extra: event.extra ?? {},
    objectMap: event.objectMap ?? null,
    signalClass: event.signalClass,
  });
}

export function capturedWorkItemFromRawMetadata(
  sourceMetadata: unknown,
  contentText: string | null,
): CapturedWorkItem | null {
  const github = githubWorkItemFromRawMetadata(sourceMetadata, contentText);
  if (github) return capturedWorkItemFromGithub(github);
  const metadata = recordFromUnknown(sourceMetadata);
  return capturedWorkItemFromObjectMap({
    provider: stringValue(metadata.provider),
    eventType: stringValue(metadata.event_type) ?? '',
    contentText: contentText ?? '',
    actor: recordFromUnknown(metadata.actor),
    extra: metadata,
    objectMap: objectMapFromUnknown(metadata.object_map),
    signalClass: metadata.signal_class,
    sourceMetadata: metadata,
  });
}

export function matchOpenTasksToGithubWorkItem(
  workItem: GithubWorkItem,
  tasks: readonly OpenTaskRow[],
  canonicalEntityId?: string | null,
): { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] {
  return matchOpenTasksToCapturedWorkItem(
    capturedWorkItemFromGithub(workItem),
    tasks,
    canonicalEntityId,
  );
}

export function matchOpenTasksToCapturedWorkItem(
  workItem: CapturedWorkItem,
  tasks: readonly OpenTaskRow[],
  canonicalEntityId?: string | null,
): { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] {
  const hard: { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] = [];
  const fuzzy: { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] = [];
  const aliasNeedles = new Set(workItem.aliases.map((alias) => alias.toLowerCase()));

  for (const task of tasks) {
    if (canonicalEntityId && task.id === canonicalEntityId) {
      hard.push({ task, match: 'provider_id' });
      continue;
    }
    const metadata = recordFromUnknown(task.metadata);
    const externalId = stringValue(metadata.integration_external_id);
    const provider = stringValue(metadata.integration_provider);
    if (provider === workItem.provider && externalId && externalId === workItem.externalId) {
      hard.push({ task, match: 'provider_id' });
      continue;
    }
    const aliases = stringArray(task.aliases).map((alias) => alias.toLowerCase());
    if (aliases.some((alias) => aliasNeedles.has(alias))) {
      hard.push({ task, match: 'alias' });
      continue;
    }
    if (taskMentionsCapturedWorkItem(task, workItem) && titlesAlign(task.canonicalName, workItem)) {
      fuzzy.push({ task, match: 'title' });
    }
  }

  if (hard.length > 0) return uniqueTasks(hard);
  if (fuzzy.length === 1) return fuzzy;
  return [];
}

export function planGithubTaskProposal(input: {
  workItem: GithubWorkItem | CapturedWorkItem;
  task: OpenTaskRow;
  match: GithubTaskProposalPlan['match'];
  assigneeUserId: string | null;
}): GithubTaskProposalPlan | null {
  const workItem = isGithubWorkItem(input.workItem)
    ? capturedWorkItemFromGithub(input.workItem)
    : input.workItem;
  const status = shouldProposeDone(workItem) ? 'done' : null;
  const assigneeUserId =
    input.task.assigneeUserId || !input.assigneeUserId ? null : input.assigneeUserId;
  const ownerUserId = input.task.ownerUserId || !input.assigneeUserId ? null : input.assigneeUserId;
  if (!status && !assigneeUserId && !ownerUserId) return null;
  return {
    taskId: input.task.id,
    taskName: input.task.canonicalName,
    status,
    assigneeUserId,
    ownerUserId,
    aliases: mergeAliases(stringArray(input.task.aliases), workItem.aliases),
    match: input.match,
  };
}

export async function proposeGithubTaskUpdatesFromRawEvent(input: {
  db: Db;
  teamId: string;
  rawEvent: {
    id: string;
    source: string;
    contentText: string | null;
    sourceMetadata: unknown;
    visibility: 'team' | 'private' | 'specific_users';
  };
}): Promise<number> {
  if (input.rawEvent.source !== 'integration') return 0;
  if (input.rawEvent.visibility !== 'team') return 0;
  const workItem = capturedWorkItemFromRawMetadata(
    input.rawEvent.sourceMetadata,
    input.rawEvent.contentText,
  );
  if (!workItem) return 0;
  return proposeGithubTaskUpdates({
    db: input.db,
    teamId: input.teamId,
    sources: [
      {
        workItem,
        rawEventId: input.rawEvent.id,
        contentText: input.rawEvent.contentText ?? workItem.title,
      },
    ],
  });
}

export async function enqueueGithubTaskProposalJob(input: {
  teamId: string;
  integrationId: string;
  externalObjectId: string;
}): Promise<void> {
  await enqueueSuggestionJob(
    {
      scope: 'github_task_proposal',
      teamId: input.teamId,
      integrationId: input.integrationId,
      externalObjectId: input.externalObjectId,
    },
    { delayMs: GITHUB_TASK_PROPOSAL_COALESCE_MS },
  );
}

export async function proposeGithubTaskUpdatesForExternalObject(input: {
  db: Db;
  teamId: string;
  externalObjectId: string;
}): Promise<number> {
  const scope = withTeam(input.db, input.teamId, PSEUDO_USER, { skipMembershipCheck: true });
  const [row] = await scope.timeline.listEvents({
    source: 'integration',
    externalObjectId: input.externalObjectId,
    limit: 1,
  });
  if (!row) return 0;
  return proposeGithubTaskUpdatesFromRawEvent({
    db: input.db,
    teamId: input.teamId,
    rawEvent: row,
  });
}

export async function proposeGithubTaskUpdatesForTeam(input: {
  db: Db;
  teamId: string;
  restrictToObjectId?: string;
  restrictToExternalObjectId?: string;
}): Promise<number> {
  const clusterRows = await input.db
    .select({
      clusterId: artifactClusters.id,
      status: artifactClusters.status,
      canonicalName: artifactClusters.canonicalName,
      canonicalEntityId: artifactClusters.canonicalEntityId,
      rawEventId: artifactEvidenceAssociations.rawEventId,
      metadata: artifactEvidenceAssociations.metadata,
    })
    .from(artifactEvidenceAssociations)
    .innerJoin(artifactClusters, eq(artifactClusters.id, artifactEvidenceAssociations.clusterId))
    .where(
      and(
        eq(artifactEvidenceAssociations.teamId, input.teamId),
        eq(artifactClusters.teamId, input.teamId),
        isNull(artifactClusters.archivedAt),
        eq(artifactClusters.artifactType, 'task'),
        or(
          sql`${artifactEvidenceAssociations.metadata} ->> 'signal_class' = 'captured_work'`,
          sql`${artifactEvidenceAssociations.metadata} ->> 'provider' in ('github', 'linear', 'monday')`,
        ),
        input.restrictToExternalObjectId
          ? sql`${artifactEvidenceAssociations.metadata} ->> 'external_object_id' = ${input.restrictToExternalObjectId}`
          : undefined,
      ),
    )
    .orderBy(desc(artifactEvidenceAssociations.createdAt))
    .limit(CLUSTER_SCAN_LIMIT);
  const latestByExternal = new Map<
    string,
    (typeof clusterRows)[number] & { externalObjectId: string }
  >();
  for (const row of clusterRows) {
    const externalId = stringValue(recordFromUnknown(row.metadata).external_object_id);
    if (!externalId || latestByExternal.has(externalId)) continue;
    latestByExternal.set(externalId, { ...row, externalObjectId: externalId });
  }
  const rawEventIds = [
    ...new Set(
      [...latestByExternal.values()]
        .map((row) => row.rawEventId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const rawEventRows =
    rawEventIds.length > 0
      ? await input.db
          .select({
            id: rawEvents.id,
            contentText: rawEvents.contentText,
            sourceMetadata: rawEvents.sourceMetadata,
            visibility: rawEvents.visibility,
          })
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.teamId, input.teamId),
              inArray(rawEvents.id, rawEventIds),
              eq(rawEvents.visibility, 'team'),
            ),
          )
      : [];
  const rawEventById = new Map(rawEventRows.map((row) => [row.id, row]));
  const sources: GithubProposalSource[] = [];
  for (const row of latestByExternal.values()) {
    if (!row.rawEventId) continue;
    const rawEvent = rawEventById.get(row.rawEventId);
    if (!rawEvent) continue;
    const workItem =
      capturedWorkItemFromRawMetadata(rawEvent.sourceMetadata, rawEvent.contentText) ??
      capturedWorkItemFromClusterRow(row);
    if (!workItem) continue;
    sources.push({
      workItem,
      rawEventId: rawEvent.id,
      contentText: rawEvent.contentText ?? workItem.title,
      canonicalEntityId: row.canonicalEntityId,
    });
  }
  return proposeGithubTaskUpdates({
    db: input.db,
    teamId: input.teamId,
    sources,
    ...(input.restrictToObjectId ? { restrictToObjectId: input.restrictToObjectId } : {}),
  });
}

async function proposeGithubTaskUpdates(input: {
  db: Db;
  teamId: string;
  sources: GithubProposalSource[];
  restrictToObjectId?: string;
}): Promise<number> {
  if (input.sources.length === 0) return 0;
  const [tasks, pendingCreates, members, githubLoginsByUserId] = await Promise.all([
    loadOpenTaskCandidates(input.db, input.teamId, input.sources, input.restrictToObjectId ?? null),
    loadPendingTaskCreates(input.db, input.teamId),
    loadTeamMembers(input.db, input.teamId),
    loadGithubLoginsByUserId(input.db, input.teamId),
  ]);
  if (tasks.length === 0 && pendingCreates.length === 0) return 0;

  const scope = withTeam(input.db, input.teamId, PSEUDO_USER, { skipMembershipCheck: true });
  let created = 0;
  for (const source of input.sources) {
    const entityMatches = matchOpenTasksToCapturedWorkItem(
      source.workItem,
      tasks,
      source.canonicalEntityId,
    ).filter((match) =>
      input.restrictToObjectId ? match.task.id === input.restrictToObjectId : true,
    );
    const assigneeUserId = resolveWorkItemAssignee(source.workItem, members, githubLoginsByUserId);
    for (const match of entityMatches) {
      const plan = planGithubTaskProposal({
        workItem: source.workItem,
        task: match.task,
        match: match.match,
        assigneeUserId,
      });
      if (!plan) continue;
      try {
        const wrote = await writeGithubTaskProposal({
          scope,
          db: input.db,
          teamId: input.teamId,
          source,
          plan,
        });
        if (wrote) created += 1;
      } catch (err) {
        log.warn(
          {
            err,
            teamId: input.teamId,
            taskId: plan.taskId,
            externalId: source.workItem.externalId,
          },
          'failed to create GitHub task proposal',
        );
      }
    }
    if (entityMatches.length > 0 || input.restrictToObjectId) continue;
    const pendingMatches = matchOpenTasksToCapturedWorkItem(
      source.workItem,
      pendingCreates.map((row) => row.task),
    );
    for (const match of pendingMatches) {
      const pending = pendingCreates.find((row) => row.task.id === match.task.id);
      if (!pending || pending.editedByUser) continue;
      const plan = planPendingCreateRefresh({
        workItem: source.workItem,
        pending,
        match: match.match,
        assigneeUserId,
      });
      if (!plan) continue;
      try {
        const wrote = await refreshPendingTaskCreate({
          scope,
          source,
          pending,
          plan,
        });
        if (wrote) created += 1;
      } catch (err) {
        log.warn(
          {
            err,
            teamId: input.teamId,
            suggestionId: pending.suggestionId,
            externalId: source.workItem.externalId,
          },
          'failed to refresh pending GitHub task create',
        );
      }
    }
  }
  return created;
}

async function writeGithubTaskProposal(input: {
  scope: ReturnType<typeof withTeam>;
  db: Db;
  teamId: string;
  source: GithubProposalSource;
  plan: GithubTaskProposalPlan;
}): Promise<boolean> {
  const { workItem } = input.source;
  const ref = githubRefLabel(workItem);
  const payload: Record<string, unknown> = {};
  const changes: string[] = [];
  if (input.plan.status) {
    payload.status = input.plan.status;
    changes.push(`mark ${input.plan.status}`);
  }
  if (input.plan.assigneeUserId) {
    payload.assigneeUserId = input.plan.assigneeUserId;
    changes.push(
      workItem.provider === 'github'
        ? 'assign the GitHub actor'
        : `assign the ${workItem.provider} actor`,
    );
  }
  if (input.plan.ownerUserId) {
    payload.ownerUserId = input.plan.ownerUserId;
  }
  if (input.plan.aliases.length > 0) payload.aliases = input.plan.aliases;
  const reason = capturedWorkReason(workItem, input.plan);
  const existingDedupeKey = await existingGithubProposalDedupeKey(
    input.db,
    input.teamId,
    input.plan.taskId,
    workItem.externalId,
  );
  const dedupeKey =
    existingDedupeKey ??
    suggestionDedupeKey({
      kind: 'github_task_proposal',
      taskId: input.plan.taskId,
      externalId: workItem.externalId,
    });
  const sourceLabel = workItem.provider === 'github' ? 'GitHub' : workItem.provider;
  await input.scope.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: `Update ${input.plan.taskName}`,
    summary: `${sourceLabel} ${ref} is enough evidence to ${changes.join(' and ')}.`,
    reason,
    confidence: input.plan.match === 'title' ? 'medium' : 'high',
    dedupeKey,
    visibility: 'team',
    evidence: [
      {
        rawEventId: input.source.rawEventId,
        quote: truncate(input.source.contentText, 500),
        metadata: {
          kind: 'github_task_proposal',
          github_external_id: workItem.externalId,
          github_event_type: workItem.eventType,
          match: input.plan.match,
        },
      },
    ],
    metadata: {
      kind: 'github_task_proposal',
      github_external_id: workItem.externalId,
      github_event_type: workItem.eventType,
      github_repo: workItem.github?.repo ?? null,
      github_number: workItem.github?.number ?? null,
      captured_work_provider: workItem.provider,
      match: input.plan.match,
    },
    items: [
      {
        operation: 'update',
        targetKind: 'task',
        targetId: input.plan.taskId,
        title: `Update ${input.plan.taskName}`,
        description: reason,
        dedupeKey: `${dedupeKey}:item`,
        proposedPayload: payload,
        evidenceRawEventIds: [input.source.rawEventId],
      },
    ],
  });
  return true;
}

function planPendingCreateRefresh(input: {
  workItem: CapturedWorkItem;
  pending: PendingTaskCreate;
  match: GithubTaskProposalPlan['match'];
  assigneeUserId: string | null;
}): GithubTaskProposalPlan | null {
  const status = shouldProposeDone(input.workItem) ? 'done' : null;
  const assigneeUserId =
    input.pending.task.assigneeUserId || !input.assigneeUserId ? null : input.assigneeUserId;
  const ownerUserId =
    input.pending.task.ownerUserId || !input.assigneeUserId ? null : input.assigneeUserId;
  const aliases = mergeAliases(stringArray(input.pending.task.aliases), input.workItem.aliases);
  const aliasesChanged = aliases.length > stringArray(input.pending.task.aliases).length;
  const statusChanged = Boolean(status) && status !== normalizeLifecycle(input.pending.task.status);
  if (!statusChanged && !assigneeUserId && !ownerUserId && !aliasesChanged) return null;
  return {
    taskId: input.pending.task.id,
    taskName: input.pending.task.canonicalName,
    status: statusChanged ? status : null,
    assigneeUserId,
    ownerUserId,
    aliases,
    match: input.match,
  };
}

async function refreshPendingTaskCreate(input: {
  scope: ReturnType<typeof withTeam>;
  source: GithubProposalSource;
  pending: PendingTaskCreate;
  plan: GithubTaskProposalPlan;
}): Promise<boolean> {
  const { workItem } = input.source;
  const ref = githubRefLabel(workItem);
  const payload = { ...input.pending.payload };
  const changes: string[] = [];
  if (input.plan.status) {
    payload.status = input.plan.status;
    changes.push(`mark ${input.plan.status}`);
  }
  if (input.plan.assigneeUserId) {
    payload.assigneeUserId = input.plan.assigneeUserId;
    changes.push('assign the GitHub actor');
  }
  if (input.plan.ownerUserId) {
    payload.ownerUserId = input.plan.ownerUserId;
  }
  if (input.plan.aliases.length > 0) payload.aliases = input.plan.aliases;
  const reason = capturedWorkReason(workItem, input.plan);
  await input.scope.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: input.pending.title,
    summary:
      changes.length > 0
        ? `GitHub ${ref} is enough evidence to ${changes.join(' and ')}.`
        : `GitHub ${ref} is now linked to this pending task.`,
    reason,
    confidence: input.plan.match === 'title' ? 'medium' : 'high',
    dedupeKey: input.pending.suggestionDedupeKey,
    visibility: 'team',
    evidence: [
      {
        rawEventId: input.source.rawEventId,
        quote: truncate(input.source.contentText, 500),
        metadata: {
          kind: 'github_task_proposal',
          github_external_id: workItem.externalId,
          github_event_type: workItem.eventType,
          match: input.plan.match,
        },
      },
    ],
    metadata: {
      kind: 'github_task_proposal',
      github_external_id: workItem.externalId,
      github_event_type: workItem.eventType,
      github_repo: workItem.github?.repo ?? null,
      github_number: workItem.github?.number ?? null,
      captured_work_provider: workItem.provider,
      match: input.plan.match,
    },
    items: [
      {
        operation: 'create',
        targetKind: input.pending.targetKind,
        title: input.pending.title,
        description: reason,
        dedupeKey: input.pending.itemDedupeKey,
        proposedPayload: payload,
        evidenceRawEventIds: [input.source.rawEventId],
      },
    ],
  });
  return true;
}

function capturedWorkReason(workItem: CapturedWorkItem, plan: GithubTaskProposalPlan): string {
  const ref = githubRefLabel(workItem);
  const sourceLabel = workItem.provider === 'github' ? 'GitHub' : workItem.provider;
  if (plan.status === 'done') {
    if (workItem.github?.kind === 'issue') {
      return `${ref} is closed on GitHub, so this Timeline task should move to done.`;
    }
    if (workItem.github?.kind === 'pull_request') {
      return `${ref} is merged on GitHub, so this Timeline task should move to done.`;
    }
    return `${ref} is done on ${sourceLabel}, so this Timeline task should move to done.`;
  }
  return `${ref} is ${workItem.actorLogin ? `@${workItem.actorLogin}'s` : 'this teammate’s'} ${sourceLabel} activity.`;
}

function normalizeLifecycle(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'complete' || normalized === 'completed' || normalized === 'resolved') {
    return 'done';
  }
  return normalized;
}

async function existingGithubProposalDedupeKey(
  db: Db,
  teamId: string,
  taskId: string,
  externalId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ dedupeKey: agentSuggestions.dedupeKey })
    .from(agentSuggestionItems)
    .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
    .where(
      and(
        eq(agentSuggestionItems.teamId, teamId),
        eq(agentSuggestions.teamId, teamId),
        eq(agentSuggestionItems.status, 'pending'),
        inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        eq(agentSuggestionItems.operation, 'update'),
        eq(agentSuggestionItems.targetKind, 'task'),
        eq(agentSuggestionItems.targetId, taskId),
        eq(agentSuggestions.visibility, 'team'),
        sql`${agentSuggestions.metadata} ->> 'kind' = 'github_task_proposal'`,
        sql`${agentSuggestions.metadata} ->> 'github_external_id' = ${externalId}`,
      ),
    )
    .limit(1);
  return row?.dedupeKey ?? null;
}

function resolveWorkItemAssignee(
  workItem: CapturedWorkItem,
  members: readonly { userId: string; name: string | null; email?: string | null }[],
  githubLoginsByUserId: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (workItem.provider !== 'github') return null;
  const logins =
    workItem.assigneeLogins.length > 0
      ? workItem.assigneeLogins
      : workItem.actorLogin
        ? [workItem.actorLogin]
        : [];
  const userIds = [
    ...new Set(
      logins
        .map((login) => resolveGithubLoginToUserId(login, members, githubLoginsByUserId))
        .filter((userId): userId is string => typeof userId === 'string'),
    ),
  ];
  return userIds.length === 1 ? (userIds[0] ?? null) : null;
}

function shouldProposeDone(workItem: CapturedWorkItem): boolean {
  if (workItem.github?.kind === 'pull_request') {
    return workItem.eventType === 'pr.merged' || workItem.status === 'done';
  }
  if (workItem.github?.kind === 'issue') {
    return workItem.eventType === 'issue.closed' || workItem.status === 'done';
  }
  return workItem.status === 'done';
}

function isGithubWorkItem(value: GithubWorkItem | CapturedWorkItem): value is GithubWorkItem {
  return 'repo' in value && 'number' in value && 'kind' in value && !('github' in value);
}

function capturedWorkItemFromObjectMap(input: {
  provider: string | null;
  eventType: string;
  contentText: string;
  actor: unknown;
  extra: Record<string, unknown>;
  objectMap: ObjectMapping | null;
  signalClass?: unknown;
  sourceMetadata?: unknown;
}): CapturedWorkItem | null {
  const objectMap = input.objectMap;
  if (!objectMap || !input.provider) return null;
  const signal = resolveSignalClass({
    signalClass: isSignalClass(input.signalClass) ? input.signalClass : null,
    provider: input.provider,
    eventType: input.eventType,
    extra: input.extra,
    objectMap,
    sourceMetadata: input.sourceMetadata,
  });
  if (signal !== 'captured_work') return null;
  if (objectMap.type !== 'task' && objectMap.type !== 'follow_up') return null;
  const status =
    objectMap.status === 'done' || objectMap.status === 'cancelled' ? objectMap.status : 'open';
  const actor = recordFromUnknown(input.actor);
  const aliases = [
    ...new Set(
      [...(objectMap.aliases ?? []), objectMap.externalId]
        .map((alias) => alias.trim())
        .filter(Boolean),
    ),
  ];
  return {
    provider: input.provider,
    externalId: objectMap.externalId,
    title:
      workItemTitleFromObjectMap(objectMap) ??
      workItemTitleFromContent(input.contentText) ??
      objectMap.displayTitle ??
      objectMap.canonicalName,
    status,
    eventType: input.eventType,
    url: objectMap.url ?? null,
    aliases,
    actorLogin: stringValue(actor.externalId) ?? stringValue(actor.name),
    assigneeLogins: [],
    github: null,
  };
}

function capturedWorkItemFromClusterRow(row: {
  status: string;
  canonicalName: string;
  externalObjectId: string | null;
  metadata: unknown;
}): CapturedWorkItem | null {
  const github = githubWorkItemFromClusterRow(row);
  if (github) return capturedWorkItemFromGithub(github);
  const externalId = row.externalObjectId;
  if (!externalId) return null;
  const metadata = recordFromUnknown(row.metadata);
  const provider = stringValue(metadata.provider);
  if (!provider) return null;
  const signal = resolveSignalClass({
    sourceMetadata: metadata,
    provider,
    eventType: stringValue(metadata.event_type),
  });
  if (signal !== 'captured_work') return null;
  return {
    provider,
    externalId,
    title: workItemTitleFromDisplay(row.canonicalName) ?? row.canonicalName,
    status: row.status === 'resolved' ? 'done' : row.status === 'cancelled' ? 'cancelled' : 'open',
    eventType: stringValue(metadata.event_type) ?? '',
    url: null,
    aliases: [externalId],
    actorLogin: null,
    assigneeLogins: [],
    github: null,
  };
}

function githubWorkItemFromParts(input: {
  eventType: string;
  externalObjectId: string | null;
  contentText: string;
  actor: unknown;
  extra: Record<string, unknown>;
  objectMap: ObjectMapping | null;
}): GithubWorkItem | null {
  const github = recordFromUnknown(input.extra.github ?? input.extra);
  const kind = githubKind(github, input.eventType);
  if (!kind) return null;
  const repo = stringValue(github.repo);
  const number = numberValue(github.number);
  if (!repo || number === null) return null;
  const actor = recordFromUnknown(input.actor);
  const status = githubWorkItemStatus(kind, input.eventType, github, input.objectMap);
  const title =
    workItemTitleFromObjectMap(input.objectMap) ??
    workItemTitleFromContent(input.contentText) ??
    `${repoDisplayName(repo)}#${String(number)}`;
  const externalId =
    input.objectMap?.externalId ??
    stringValue(input.externalObjectId) ??
    (kind === 'issue' ? `${repo}#issue:${String(number)}` : `${repo}#${String(number)}`);
  return {
    repo,
    number,
    kind,
    title,
    externalId,
    status,
    eventType: input.eventType,
    url: stringValue(github.url) ?? input.objectMap?.url ?? null,
    aliases: input.objectMap?.aliases ?? defaultGithubAliases(kind, repo, number),
    actorLogin:
      stringValue(actor.externalId) ?? stringValue(actor.name) ?? stringValue(actor.login),
    assigneeLogins: assigneeLoginsFromGithub(github),
  };
}

function githubWorkItemFromClusterRow(row: {
  status: string;
  canonicalName: string;
  externalObjectId: string | null;
  metadata: unknown;
}): GithubWorkItem | null {
  const externalId = row.externalObjectId;
  if (!externalId) return null;
  const parsed = parseGithubExternalId(externalId);
  if (!parsed) return null;
  const metadata = recordFromUnknown(row.metadata);
  const eventType = stringValue(metadata.event_type) ?? '';
  return {
    repo: parsed.repo,
    number: parsed.number,
    kind: parsed.kind,
    title: workItemTitleFromDisplay(row.canonicalName) ?? row.canonicalName,
    externalId,
    status: row.status === 'resolved' ? 'done' : row.status === 'cancelled' ? 'cancelled' : 'open',
    eventType,
    url: null,
    aliases: defaultGithubAliases(parsed.kind, parsed.repo, parsed.number),
    actorLogin: null,
    assigneeLogins: [],
  };
}

function githubKind(
  github: Record<string, unknown>,
  eventType: string,
): 'pull_request' | 'issue' | null {
  const type = stringValue(github.type);
  if (type === 'pull_request' || type === 'issue') return type;
  // Prefix matching would treat `issue_comment.*` and `pr.review.*` as work
  // items. Comments, reviews, commits, and CI stay out of this path.
  if (GITHUB_PULL_REQUEST_EVENT_TYPES.has(eventType)) return 'pull_request';
  if (GITHUB_ISSUE_EVENT_TYPES.has(eventType)) return 'issue';
  return null;
}

function githubWorkItemStatus(
  kind: 'pull_request' | 'issue',
  eventType: string,
  github: Record<string, unknown>,
  objectMap: ObjectMapping | null,
): 'open' | 'done' | 'cancelled' {
  if (
    objectMap?.status === 'done' ||
    objectMap?.status === 'cancelled' ||
    objectMap?.status === 'open'
  ) {
    return objectMap.status;
  }
  if (kind === 'pull_request') {
    if (eventType === 'pr.merged' || stringValue(github.merged_at)) return 'done';
    if (eventType === 'pr.closed' || stringValue(github.state) === 'closed') return 'cancelled';
    return 'open';
  }
  if (eventType === 'issue.closed' || stringValue(github.state) === 'closed') return 'done';
  return 'open';
}

async function loadOpenTaskCandidates(
  db: Db,
  teamId: string,
  sources: GithubProposalSource[],
  restrictToObjectId: string | null,
): Promise<OpenTaskRow[]> {
  const externalIds = [...new Set(sources.map((source) => source.workItem.externalId))];
  const canonicalEntityIds = [
    ...new Set(
      sources
        .map((source) => source.canonicalEntityId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const repoNames = [
    ...new Set(
      sources.flatMap((source) => {
        const github = source.workItem.github;
        if (github) return [github.repo, repoDisplayName(github.repo)];
        return source.workItem.aliases;
      }),
    ),
  ].filter((name) => name.length >= 3);
  const aliasNeedles = [
    ...new Set(
      sources.flatMap((source) => [source.workItem.externalId, ...source.workItem.aliases]),
    ),
  ].filter((name) => name.length >= 3);
  const likeClauses = [
    ...repoNames.map(
      (name) => sql`lower(${entities.canonicalName}) like ${`%${escapeLike(name.toLowerCase())}%`}`,
    ),
    ...aliasNeedles.map(
      (name) =>
        sql`lower(coalesce(${entities.aliases}::text, '')) like ${`%${escapeLike(name.toLowerCase())}%`}`,
    ),
  ];
  const providers = [...new Set(sources.map((source) => source.workItem.provider))];
  const identityClauses = [
    and(
      inArray(sql`${entities.metadata} ->> 'integration_provider'`, providers),
      inArray(sql`${entities.metadata} ->> 'integration_external_id'`, externalIds),
    ),
    ...(canonicalEntityIds.length > 0 ? [inArray(entities.id, canonicalEntityIds)] : []),
    ...(likeClauses.length > 0 ? [or(...likeClauses)] : []),
  ];
  const rows = await db
    .select({
      id: entities.id,
      canonicalName: entities.canonicalName,
      aliases: entities.aliases,
      metadata: entities.metadata,
      status: entities.status,
      ownerUserId: entities.ownerUserId,
      assigneeUserId: entities.assigneeUserId,
    })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, teamId),
        eq(entities.type, 'task'),
        isNull(entities.archivedAt),
        isNull(entities.mergedIntoId),
        sql`lower(${entities.status}) not in ('done', 'cancelled', 'canceled', 'shipped')`,
        restrictToObjectId ? eq(entities.id, restrictToObjectId) : or(...identityClauses),
      ),
    )
    .limit(TASK_CANDIDATE_LIMIT);
  return rows.filter(
    (row) => !OPEN_TASK_STATUSES_EXCLUDED.includes(row.status.toLowerCase() as never),
  );
}

async function loadPendingTaskCreates(db: Db, teamId: string): Promise<PendingTaskCreate[]> {
  const rows = await db
    .select({
      itemId: agentSuggestionItems.id,
      suggestionId: agentSuggestions.id,
      suggestionDedupeKey: agentSuggestions.dedupeKey,
      itemDedupeKey: agentSuggestionItems.dedupeKey,
      targetKind: agentSuggestionItems.targetKind,
      title: agentSuggestionItems.title,
      payload: agentSuggestionItems.proposedPayload,
      itemMetadata: agentSuggestionItems.metadata,
    })
    .from(agentSuggestionItems)
    .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
    .where(
      and(
        eq(agentSuggestionItems.teamId, teamId),
        eq(agentSuggestions.teamId, teamId),
        eq(agentSuggestionItems.status, 'pending'),
        inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        eq(agentSuggestionItems.operation, 'create'),
        inArray(agentSuggestionItems.targetKind, ['task', 'object']),
        eq(agentSuggestions.visibility, 'team'),
        isNull(agentSuggestionItems.targetId),
      ),
    )
    .orderBy(desc(agentSuggestionItems.updatedAt))
    .limit(PENDING_CREATE_LIMIT);
  return rows.flatMap((row) => {
    const pending = pendingCreateFromRow(row);
    return pending ? [pending] : [];
  });
}

function pendingCreateFromRow(row: {
  itemId: string;
  suggestionId: string;
  suggestionDedupeKey: string;
  itemDedupeKey: string;
  targetKind: string;
  title: string;
  payload: unknown;
  itemMetadata: unknown;
}): PendingTaskCreate | null {
  if (row.targetKind !== 'task' && row.targetKind !== 'object') return null;
  const payload = recordFromUnknown(row.payload);
  const type = stringValue(payload.type);
  if (row.targetKind === 'object' && type && type !== 'task') return null;
  const canonicalName = stringValue(payload.canonicalName) ?? row.title.trim();
  if (!canonicalName) return null;
  const nestedMetadata = recordFromUnknown(payload.metadata);
  return {
    suggestionId: row.suggestionId,
    suggestionDedupeKey: row.suggestionDedupeKey,
    itemDedupeKey: row.itemDedupeKey,
    targetKind: row.targetKind,
    title: row.title,
    editedByUser: Object.hasOwn(recordFromUnknown(row.itemMetadata), 'proposal_edited_by_user_id'),
    payload,
    task: {
      id: row.itemId,
      canonicalName,
      aliases: stringArray(payload.aliases),
      metadata: {
        integration_provider:
          stringValue(payload.integration_provider) ??
          stringValue(nestedMetadata.integration_provider),
        integration_external_id:
          stringValue(payload.integration_external_id) ??
          stringValue(nestedMetadata.integration_external_id),
      },
      status: stringValue(payload.status) ?? 'open',
      ownerUserId: stringValue(payload.ownerUserId),
      assigneeUserId: stringValue(payload.assigneeUserId),
    },
  };
}

async function loadTeamMembers(
  db: Db,
  teamId: string,
): Promise<{ userId: string; name: string | null; email: string | null }[]> {
  return db
    .select({ userId: teamMembers.userId, name: users.name, email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt)))
    .limit(100);
}

async function loadGithubLoginsByUserId(db: Db, teamId: string): Promise<Map<string, string[]>> {
  const integrationRows = await db
    .select({
      connectedByUserId: integrations.connectedByUserId,
      displayName: integrations.displayName,
      connectionOwnerUserId: providerConnections.ownerUserId,
      connectionDisplayName: providerConnections.displayName,
    })
    .from(integrations)
    .leftJoin(providerConnections, eq(providerConnections.id, integrations.providerConnectionId))
    .where(and(eq(integrations.teamId, teamId), eq(integrations.provider, 'github')));
  const loginsByUserId = new Map<string, string[]>();
  const add = (userId: string | null, displayName: string | null) => {
    if (!userId || !displayName) return;
    const login = githubLoginFromConnectionDisplayName(displayName);
    if (!login) return;
    const existing = loginsByUserId.get(userId) ?? [];
    if (!existing.some((candidate) => candidate.toLowerCase() === login.toLowerCase())) {
      existing.push(login);
    }
    loginsByUserId.set(userId, existing);
  };
  for (const row of integrationRows) {
    add(row.connectedByUserId, row.displayName);
    add(row.connectionOwnerUserId, row.connectionDisplayName);
  }
  return loginsByUserId;
}

function taskMentionsGithubWorkItem(task: OpenTaskRow, workItem: GithubWorkItem): boolean {
  const haystack = `${task.canonicalName} ${stringArray(task.aliases).join(' ')}`.toLowerCase();
  const repoName = repoDisplayName(workItem.repo).toLowerCase();
  const fullRepo = workItem.repo.toLowerCase();
  const number = String(workItem.number);
  const mentionsRepo = haystack.includes(repoName) || haystack.includes(fullRepo);
  const mentionsNumber =
    haystack.includes(`${repoName}#${number}`) ||
    haystack.includes(`${fullRepo}#${number}`) ||
    new RegExp(`(?:pr\\s*#|#)${number}\\b`, 'i').test(haystack);
  return mentionsRepo && mentionsNumber;
}

function taskMentionsCapturedWorkItem(task: OpenTaskRow, workItem: CapturedWorkItem): boolean {
  if (workItem.github) return taskMentionsGithubWorkItem(task, workItem.github);
  const haystack = `${task.canonicalName} ${stringArray(task.aliases).join(' ')}`.toLowerCase();
  return workItem.aliases.some((alias) => haystack.includes(alias.toLowerCase()));
}

function titlesAlign(taskName: string, workItem: CapturedWorkItem): boolean {
  const task = normalizeTitle(taskName);
  const work = normalizeTitle(workItem.title);
  if (!work || work.length < 8) {
    return workItem.github ? mentionsNumberOnly(taskName, workItem.github) : false;
  }
  if (task.includes(work) || work.includes(task)) return true;
  const taskTokens = new Set(task.split(' ').filter((token) => token.length >= 3));
  const workTokens = [...new Set(work.split(' ').filter((token) => token.length >= 3))];
  if (workTokens.length === 0 || taskTokens.size === 0) return false;
  const shared = workTokens.filter((token) => taskTokens.has(token)).length;
  return shared >= Math.min(3, workTokens.length) && shared / workTokens.length >= 0.6;
}

function mentionsNumberOnly(taskName: string, workItem: GithubWorkItem): boolean {
  return taskMentionsGithubWorkItem(
    {
      id: '',
      canonicalName: taskName,
      aliases: [],
      metadata: {},
      status: 'todo',
      ownerUserId: null,
      assigneeUserId: null,
    },
    workItem,
  );
}

function workItemAliases(workItem: GithubWorkItem): string[] {
  return [
    ...new Set([
      ...workItem.aliases,
      ...defaultGithubAliases(workItem.kind, workItem.repo, workItem.number),
    ]),
  ];
}

function defaultGithubAliases(
  kind: 'pull_request' | 'issue',
  repo: string,
  number: number,
): string[] {
  const n = String(number);
  if (kind === 'issue') {
    return [`ISSUE-${repo}-${n}`, `${repo}#issue:${n}`, `${repo}#${n}`];
  }
  return [`PR-${repo}-${n}`, `${repo}#${n}`, `PR #${n}`];
}

function mergeAliases(existing: string[], proposed: string[]): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const alias of [...existing, ...proposed]) {
    const trimmed = alias.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    aliases.push(trimmed);
  }
  return aliases;
}

function uniqueTasks(
  matches: { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[],
): { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.task.id)) return false;
    seen.add(match.task.id);
    return true;
  });
}

function workItemTitleFromObjectMap(objectMap: ObjectMapping | null): string | null {
  if (!objectMap) return null;
  return workItemTitleFromDisplay(objectMap.displayTitle ?? objectMap.canonicalName);
}

function workItemTitleFromDisplay(value: string | null | undefined): string | null {
  if (!value) return null;
  const colon = value.indexOf(': ');
  if (colon >= 0 && colon < value.length - 2) return value.slice(colon + 2).trim() || null;
  const dash = value.indexOf(' — ');
  if (dash >= 0 && dash < value.length - 3) return value.slice(dash + 3).trim() || null;
  return value.trim() || null;
}

function workItemTitleFromContent(contentText: string): string | null {
  const firstLine = contentText.split('\n')[0]?.trim() ?? '';
  return workItemTitleFromDisplay(firstLine);
}

function parseGithubExternalId(
  externalId: string,
): { repo: string; number: number; kind: 'pull_request' | 'issue' } | null {
  const issue = /^([^#]+)#issue:(\d+)$/.exec(externalId);
  if (issue?.[1] && issue[2]) {
    return { repo: issue[1], number: Number(issue[2]), kind: 'issue' };
  }
  const pr = /^([^#]+)#(\d+)$/.exec(externalId);
  if (pr?.[1] && pr[2]) {
    return { repo: pr[1], number: Number(pr[2]), kind: 'pull_request' };
  }
  return null;
}

function githubRefLabel(workItem: CapturedWorkItem): string {
  if (workItem.github) return `${workItem.github.repo}#${String(workItem.github.number)}`;
  return workItem.aliases[0] ?? workItem.externalId;
}

function repoDisplayName(repo: string): string {
  return repo.split('/').pop() ?? repo;
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function assigneeLoginsFromGithub(github: Record<string, unknown>): string[] {
  const assignees = github.assignees;
  if (!Array.isArray(assignees)) return [];
  return assignees.flatMap((assignee) => {
    const login = stringValue(recordFromUnknown(assignee).login);
    return login ? [login] : [];
  });
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
