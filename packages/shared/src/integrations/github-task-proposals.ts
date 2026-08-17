import {
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

import type { IntegrationEvent, IntegrationRow, ObjectMapping } from '#src/integrations/types.js';

import { childLogger } from '#src/logger.js';
import { suggestionDedupeKey } from '#src/suggestions/dedupe-key.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('integrations:github-task-proposals');
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const OPEN_TASK_STATUSES_EXCLUDED = ['done', 'cancelled', 'canceled', 'shipped'] as const;
const TASK_CANDIDATE_LIMIT = 500;
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
  workItem: GithubWorkItem;
  rawEventId: string;
  contentText: string;
  canonicalEntityId?: string | null;
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
  members: readonly { userId: string; name: string | null }[],
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
  if (nameMatches.length === 1) return nameMatches[0]?.userId ?? null;
  return null;
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
    objectMap: null,
  });
}

export function matchOpenTasksToGithubWorkItem(
  workItem: GithubWorkItem,
  tasks: readonly OpenTaskRow[],
  canonicalEntityId?: string | null,
): { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] {
  const hard: { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] = [];
  const fuzzy: { task: OpenTaskRow; match: GithubTaskProposalPlan['match'] }[] = [];
  const aliasNeedles = new Set(workItemAliases(workItem).map((alias) => alias.toLowerCase()));

  for (const task of tasks) {
    if (canonicalEntityId && task.id === canonicalEntityId) {
      hard.push({ task, match: 'provider_id' });
      continue;
    }
    const metadata = recordFromUnknown(task.metadata);
    const externalId = stringValue(metadata.integration_external_id);
    const provider = stringValue(metadata.integration_provider);
    if (provider === 'github' && externalId && externalId === workItem.externalId) {
      hard.push({ task, match: 'provider_id' });
      continue;
    }
    const aliases = stringArray(task.aliases).map((alias) => alias.toLowerCase());
    if (aliases.some((alias) => aliasNeedles.has(alias))) {
      hard.push({ task, match: 'alias' });
      continue;
    }
    if (taskMentionsGithubWorkItem(task, workItem) && titlesAlign(task.canonicalName, workItem)) {
      fuzzy.push({ task, match: 'title' });
    }
  }

  if (hard.length > 0) return uniqueTasks(hard);
  if (fuzzy.length === 1) return fuzzy;
  return [];
}

export function planGithubTaskProposal(input: {
  workItem: GithubWorkItem;
  task: OpenTaskRow;
  match: GithubTaskProposalPlan['match'];
  assigneeUserId: string | null;
}): GithubTaskProposalPlan | null {
  const status = shouldProposeDone(input.workItem) ? 'done' : null;
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
    aliases: mergeAliases(stringArray(input.task.aliases), workItemAliases(input.workItem)),
    match: input.match,
  };
}

export async function proposeGithubTaskUpdatesFromEvents(input: {
  db: Db;
  integration: Pick<IntegrationRow, 'id' | 'teamId' | 'provider' | 'connectedByUserId'>;
  events: IntegrationEvent[];
  rawEventIdsByDedupKey: Map<string, string>;
}): Promise<number> {
  if (input.integration.provider !== 'github') return 0;
  const sources: GithubProposalSource[] = [];
  for (const event of input.events) {
    const workItem = githubWorkItemFromIntegrationEvent(event);
    const rawEventId = input.rawEventIdsByDedupKey.get(event.dedupKey);
    if (!workItem || !rawEventId) continue;
    sources.push({
      workItem,
      rawEventId,
      contentText: event.contentText,
    });
  }
  return proposeGithubTaskUpdates({
    db: input.db,
    teamId: input.integration.teamId,
    sources,
  });
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
  const workItem = githubWorkItemFromRawMetadata(
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

export async function proposeGithubTaskUpdatesForTeam(input: {
  db: Db;
  teamId: string;
  restrictToObjectId?: string;
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
        sql`${artifactEvidenceAssociations.metadata} ->> 'provider' = 'github'`,
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
      githubWorkItemFromRawMetadata(rawEvent.sourceMetadata, rawEvent.contentText) ??
      githubWorkItemFromClusterRow(row);
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
  const [tasks, members, githubLoginsByUserId] = await Promise.all([
    loadOpenTaskCandidates(input.db, input.teamId, input.sources, input.restrictToObjectId ?? null),
    loadTeamMembers(input.db, input.teamId),
    loadGithubLoginsByUserId(input.db, input.teamId),
  ]);
  if (tasks.length === 0) return 0;

  const scope = withTeam(input.db, input.teamId, PSEUDO_USER, { skipMembershipCheck: true });
  let created = 0;
  for (const source of input.sources) {
    const matches = matchOpenTasksToGithubWorkItem(
      source.workItem,
      tasks,
      source.canonicalEntityId,
    ).filter((match) =>
      input.restrictToObjectId ? match.task.id === input.restrictToObjectId : true,
    );
    const assigneeUserId = resolveWorkItemAssignee(source.workItem, members, githubLoginsByUserId);
    for (const match of matches) {
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
  }
  return created;
}

async function writeGithubTaskProposal(input: {
  scope: ReturnType<typeof withTeam>;
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
    changes.push('assign the GitHub actor');
  }
  if (input.plan.ownerUserId) {
    payload.ownerUserId = input.plan.ownerUserId;
  }
  if (input.plan.aliases.length > 0) payload.aliases = input.plan.aliases;
  const reason = input.plan.status
    ? `${ref} is merged on GitHub, so this Timeline task should move to done.`
    : `${ref} is ${workItem.actorLogin ? `@${workItem.actorLogin}'s` : 'this teammate’s'} GitHub activity.`;
  const dedupeKey = suggestionDedupeKey({
    kind: 'github_task_proposal',
    taskId: input.plan.taskId,
    externalId: workItem.externalId,
    status: input.plan.status,
    assigneeUserId: input.plan.assigneeUserId,
    ownerUserId: input.plan.ownerUserId,
  });
  await input.scope.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: `Update ${input.plan.taskName}`,
    summary: `GitHub ${ref} is enough evidence to ${changes.join(' and ')}.`,
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
      github_repo: workItem.repo,
      github_number: workItem.number,
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

function resolveWorkItemAssignee(
  workItem: GithubWorkItem,
  members: readonly { userId: string; name: string | null }[],
  githubLoginsByUserId: ReadonlyMap<string, readonly string[]>,
): string | null {
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

function shouldProposeDone(workItem: GithubWorkItem): boolean {
  if (workItem.kind === 'pull_request') {
    return workItem.eventType === 'pr.merged' || workItem.status === 'done';
  }
  return workItem.eventType === 'issue.closed' || workItem.status === 'done';
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
      sources.flatMap((source) => [source.workItem.repo, repoDisplayName(source.workItem.repo)]),
    ),
  ];
  const likeClauses = repoNames.map(
    (name) => sql`lower(${entities.canonicalName}) like ${`%${escapeLike(name.toLowerCase())}%`}`,
  );
  const identityClauses = [
    and(
      sql`(${entities.metadata} ->> 'integration_provider') = 'github'`,
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

async function loadTeamMembers(
  db: Db,
  teamId: string,
): Promise<{ userId: string; name: string | null }[]> {
  return db
    .select({ userId: teamMembers.userId, name: users.name })
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

function titlesAlign(taskName: string, workItem: GithubWorkItem): boolean {
  const task = normalizeTitle(taskName);
  const work = normalizeTitle(workItem.title);
  if (!work || work.length < 8) return mentionsNumberOnly(taskName, workItem);
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

function githubRefLabel(workItem: GithubWorkItem): string {
  return `${workItem.repo}#${String(workItem.number)}`;
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
