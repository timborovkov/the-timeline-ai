import {
  type Db,
  integrationSelections,
  integrationSyncState,
  integrations,
  rawEvents,
  slackConversationBindings,
  slackWorkspaces,
  telegramChatBindings,
} from '@timeline/db';
import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';

import { decodeCursor, encodeCursor, pageWindow } from '#src/pagination.js';
import { timelineEventMatchesGroup } from '#src/timeline-moments/index.js';
import { rawEventIsActive, rawEventVisibleToUser } from '#src/visibility.js';

import type {
  EventListFilters,
  ListIntegrationSearchEventIdsInput,
  IntegrationSearchEventIds,
  PaginatedResult,
  TimelineOriginFilter,
  TimelineSourceFacet,
} from '#src/timeline/types.js';
import type { TimelineMomentLookupPlan } from '#src/timeline-moments/index.js';

const RECENT_SOURCE_FACET_EVENT_LIMIT = 2_000;

interface TimelineReadScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: () => Promise<unknown>;
  senderFilterCondition: (
    filters: Pick<EventListFilters, 'personObjectId' | 'senderHandle' | 'senderSource'>,
  ) => Promise<SQL | null | undefined>;
}

export function createTimelineReadScope({
  db,
  teamId,
  userId,
  ensureMember,
  senderFilterCondition,
}: TimelineReadScopeDeps) {
  const visibilityFilter = rawEventVisibleToUser(userId);
  const activeRawEventFilter = rawEventIsActive();

  async function getEventsByIdsImpl(ids: string[]) {
    if (ids.length === 0) return [];
    await ensureMember();
    return db
      .select()
      .from(rawEvents)
      .where(
        and(
          inArray(rawEvents.id, ids),
          eq(rawEvents.teamId, teamId),
          visibilityFilter,
          activeRawEventFilter,
        ),
      );
  }

  async function listIntegrationSearchEventIdsImpl(
    input: ListIntegrationSearchEventIdsInput,
  ): Promise<IntegrationSearchEventIds> {
    await ensureMember();
    const mondaySelectionConditions = [
      input.mondayBoardIds && input.mondayBoardIds.length > 0
        ? inArray(
            sql<string>`COALESCE(${rawEvents.sourceMetadata} ->> 'monday_parent_board_id', ${rawEvents.sourceMetadata} ->> 'monday_board_id')`,
            input.mondayBoardIds,
          )
        : undefined,
      input.mondayDocIds && input.mondayDocIds.length > 0
        ? inArray(sql<string>`${rawEvents.sourceMetadata} ->> 'monday_doc_id'`, input.mondayDocIds)
        : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const mondaySelectionCondition =
      mondaySelectionConditions.length > 0 ? or(...mondaySelectionConditions) : undefined;
    const conditions = [
      eq(rawEvents.teamId, teamId),
      visibilityFilter,
      activeRawEventFilter,
      eq(rawEvents.source, 'integration'),
    ];
    if (input.provider === 'monday') {
      if (!mondaySelectionCondition) return { eventIds: [], truncated: false };
      conditions.push(
        sql`${rawEvents.sourceMetadata} ->> 'provider' = 'monday'`,
        mondaySelectionCondition,
      );
    } else if (input.provider) {
      conditions.push(sql`${rawEvents.sourceMetadata} ->> 'provider' = ${input.provider}`);
    } else if (mondaySelectionCondition) {
      conditions.push(
        sql`(${rawEvents.sourceMetadata} ->> 'provider' IS DISTINCT FROM 'monday' OR (${rawEvents.sourceMetadata} ->> 'provider' = 'monday' AND ${mondaySelectionCondition}))`,
      );
    } else {
      conditions.push(sql`${rawEvents.sourceMetadata} ->> 'provider' IS DISTINCT FROM 'monday'`);
    }

    const rows = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(input.limit + 1);
    return {
      eventIds: rows.slice(0, input.limit).map((row) => row.id),
      truncated: rows.length > input.limit,
    };
  }

  async function listEventsPage(
    filters: EventListFilters = {},
  ): Promise<PaginatedResult<typeof rawEvents.$inferSelect>> {
    const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
    const rows = await listEvents({ ...filters, limit: limit + 1 });
    return pageWindow(rows, limit, (row) => ({
      at: row.occurredAt.toISOString(),
      id: row.id,
    }));
  }

  async function listAllEventsInWindow(filters: {
    from: Date;
    to: Date;
  }): Promise<(typeof rawEvents.$inferSelect)[]> {
    const all: (typeof rawEvents.$inferSelect)[] = [];
    let cursor: string | null = null;
    do {
      const rows = await listEventsArrivedInWindow({
        from: filters.from,
        to: filters.to,
        limit: 101,
        ...(cursor ? { cursor } : {}),
      });
      const page = rows.slice(0, 100);
      all.push(...page);
      const last = page.at(-1);
      cursor =
        rows.length > 100 && last
          ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id })
          : null;
    } while (cursor);
    return all;
  }

  async function getEvent(id: string) {
    await ensureMember();
    const rows = await db
      .select()
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.id, id),
          eq(rawEvents.teamId, teamId),
          visibilityFilter,
          activeRawEventFilter,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async function listEvents(
    filters: EventListFilters = {},
  ): Promise<(typeof rawEvents.$inferSelect)[]> {
    await ensureMember();
    const conditions = [eq(rawEvents.teamId, teamId), visibilityFilter, activeRawEventFilter];
    const authorUserId = filters.authorUserId;
    if (Array.isArray(authorUserId) && authorUserId.length > 0) {
      conditions.push(inArray(rawEvents.authorUserId, authorUserId));
    } else if (typeof authorUserId === 'string') {
      conditions.push(eq(rawEvents.authorUserId, authorUserId));
    }
    const senderCondition = await senderFilterCondition(filters);
    if (senderCondition) conditions.push(senderCondition);
    if (filters.from) conditions.push(gte(rawEvents.occurredAt, filters.from));
    if (filters.to) conditions.push(lt(rawEvents.occurredAt, filters.to));
    if (Array.isArray(filters.source) && filters.source.length > 0) {
      conditions.push(
        inArray(rawEvents.source, filters.source as (typeof rawEvents.source.enumValues)[number][]),
      );
    } else if (filters.source) {
      conditions.push(
        eq(rawEvents.source, filters.source as (typeof rawEvents.source.enumValues)[number]),
      );
    }
    if (filters.externalObjectId) {
      conditions.push(
        sql`${rawEvents.sourceMetadata} ->> 'external_object_id' = ${filters.externalObjectId}`,
      );
    }
    const originCondition = timelineOriginFilterCondition(filters.origins);
    if (originCondition) conditions.push(originCondition);
    const cursor = decodeCursor(filters.cursor);
    if (filters.cursor && !cursor) throw new Error('Invalid cursor');
    if (cursor) {
      const cursorDate = new Date(cursor.at);
      conditions.push(
        or(
          lt(rawEvents.occurredAt, cursorDate),
          and(eq(rawEvents.occurredAt, cursorDate), lt(rawEvents.id, cursor.id)),
        ),
      );
    }
    return db
      .select()
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(filters.limit ?? 200);
  }

  async function listEventsArrivedInWindow(filters: {
    from: Date;
    to: Date;
    limit: number;
    cursor?: string | null;
  }): Promise<(typeof rawEvents.$inferSelect)[]> {
    await ensureMember();
    const conditions = [
      eq(rawEvents.teamId, teamId),
      visibilityFilter,
      activeRawEventFilter,
      or(
        and(gte(rawEvents.occurredAt, filters.from), lt(rawEvents.occurredAt, filters.to)),
        and(gte(rawEvents.createdAt, filters.from), lt(rawEvents.createdAt, filters.to)),
      ),
    ];
    const cursor = decodeCursor(filters.cursor);
    if (filters.cursor && !cursor) throw new Error('Invalid cursor');
    if (cursor) {
      const cursorDate = new Date(cursor.at);
      conditions.push(
        or(
          lt(rawEvents.occurredAt, cursorDate),
          and(eq(rawEvents.occurredAt, cursorDate), lt(rawEvents.id, cursor.id)),
        ),
      );
    }
    return db
      .select()
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(filters.limit);
  }

  function timelineOriginFilterCondition(origins: TimelineOriginFilter[] | undefined) {
    if (!origins?.length) return undefined;
    const predicates = origins.map((origin) => {
      switch (origin.kind) {
        case 'provider':
          return and(
            eq(rawEvents.source, 'integration'),
            sql`${rawEvents.sourceMetadata} ->> 'provider' = ${origin.provider}`,
          );
        case 'monday_board':
          return and(
            eq(rawEvents.source, 'integration'),
            sql`${rawEvents.sourceMetadata} ->> 'provider' = 'monday'`,
            sql`${rawEvents.sourceMetadata} ->> 'monday_board_id' = ${origin.boardId}`,
          );
        case 'github_repo':
          return and(
            eq(rawEvents.source, 'integration'),
            sql`${rawEvents.sourceMetadata} ->> 'provider' = 'github'`,
            sql`${rawEvents.sourceMetadata} #>> '{github,repo}' = ${origin.repo}`,
          );
        case 'slack_channel': {
          const workspaceCondition = origin.workspaceId
            ? sql`COALESCE(${rawEvents.sourceMetadata} ->> 'slack_workspace_id', ${rawEvents.sourceMetadata} ->> 'slack_team_id') = ${origin.workspaceId}`
            : undefined;
          return and(
            or(
              eq(rawEvents.source, 'slack'),
              and(
                eq(rawEvents.source, 'integration'),
                sql`${rawEvents.sourceMetadata} ->> 'provider' = 'slack'`,
              ),
            ),
            sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${origin.channelId}`,
            workspaceCondition,
          );
        }
        case 'telegram_chat':
          return and(
            eq(rawEvents.source, 'telegram'),
            sql`${rawEvents.sourceMetadata} ->> 'tg_chat_id' = ${origin.chatId}`,
          );
      }
    });
    return or(...predicates);
  }

  function addTimelineSourceFacetFromEvent(
    add: (key: string, facet: TimelineSourceFacet, hasDisplayLabel: boolean) => void,
    row: {
      source: (typeof rawEvents.$inferSelect)['source'];
      provider: string | null;
      mondayBoardId: string | null;
      mondayBoardName: string | null;
      githubRepo: string | null;
      slackWorkspaceId: string | null;
      slackChannelId: string | null;
      slackChannelName: string | null;
      telegramChatId: string | null;
      telegramChatTitle: string | null;
    },
  ): void {
    if (row.source === 'integration' && row.provider) {
      add(
        `provider:${row.provider}`,
        {
          filter: { kind: 'provider', provider: row.provider },
          label: row.provider,
          eventCount: 1,
        },
        true,
      );
    }
    if (row.provider === 'monday' && row.mondayBoardId) {
      add(
        `monday:${row.mondayBoardId}`,
        {
          filter: { kind: 'monday_board', boardId: row.mondayBoardId },
          label: row.mondayBoardName ?? row.mondayBoardId,
          eventCount: 1,
        },
        Boolean(row.mondayBoardName),
      );
    }
    if (row.provider === 'github' && row.githubRepo) {
      add(
        `github:${row.githubRepo}`,
        {
          filter: { kind: 'github_repo', repo: row.githubRepo },
          label: row.githubRepo,
          eventCount: 1,
        },
        true,
      );
    }
    if ((row.source === 'slack' || row.provider === 'slack') && row.slackChannelId) {
      add(
        `slack:${row.slackWorkspaceId ?? ''}:${row.slackChannelId}`,
        {
          filter: {
            kind: 'slack_channel',
            channelId: row.slackChannelId,
            ...(row.slackWorkspaceId ? { workspaceId: row.slackWorkspaceId } : {}),
          },
          label: slackChannelDisplayLabel(row.slackChannelName),
          eventCount: 1,
        },
        Boolean(row.slackChannelName),
      );
    }
    if (row.source === 'telegram' && row.telegramChatId) {
      add(
        `telegram:${row.telegramChatId}`,
        {
          filter: { kind: 'telegram_chat', chatId: row.telegramChatId },
          label: row.telegramChatTitle ?? row.telegramChatId,
          eventCount: 1,
        },
        Boolean(row.telegramChatTitle),
      );
    }
  }

  function slackChannelDisplayLabel(label: string | null): string {
    const normalized = label?.trim().replace(/^#/, '');
    return normalized ? `#${normalized}` : 'Unnamed channel';
  }

  async function listSourceFacets(): Promise<TimelineSourceFacet[]> {
    await ensureMember();
    const facets = new Map<string, TimelineSourceFacet>();
    function add(key: string, facet: TimelineSourceFacet, replaceLabel = true): void {
      const current = facets.get(key);
      facets.set(key, {
        ...(current ?? facet),
        ...(replaceLabel ? facet : {}),
        eventCount: facet.eventCount + (current?.eventCount ?? 0),
      });
    }

    const integrationVisibility = or(
      eq(integrations.visibilityDefault, 'team'),
      eq(integrations.connectedByUserId, userId),
      and(
        eq(integrations.visibilityDefault, 'specific_users'),
        sql`${userId} = ANY(COALESCE(${integrations.visibilityDefaultUserIds}, ARRAY[]::uuid[]))`,
      ),
    );
    const provider = sql<string | null>`${rawEvents.sourceMetadata} ->> 'provider'`;
    const mondayBoardId = sql<string | null>`${rawEvents.sourceMetadata} ->> 'monday_board_id'`;
    const mondayBoardName = sql<string | null>`${rawEvents.sourceMetadata} ->> 'monday_board_name'`;
    const githubRepo = sql<string | null>`${rawEvents.sourceMetadata} #>> '{github,repo}'`;
    const slackWorkspaceId = sql<
      string | null
    >`COALESCE(${rawEvents.sourceMetadata} ->> 'slack_workspace_id', ${rawEvents.sourceMetadata} ->> 'slack_team_id')`;
    const slackChannelId = sql<string | null>`${rawEvents.sourceMetadata} ->> 'slack_channel_id'`;
    const slackChannelName = sql<
      string | null
    >`${rawEvents.sourceMetadata} ->> 'slack_channel_name'`;
    const telegramChatId = sql<string | null>`${rawEvents.sourceMetadata} ->> 'tg_chat_id'`;
    const telegramChatTitle = sql<string | null>`${rawEvents.sourceMetadata} ->> 'tg_chat_title'`;
    const sourceFacetRows = await Promise.all([
      db
        .select({
          provider: integrations.provider,
          externalAccountId: integrations.externalAccountId,
          selectionKind: integrationSelections.selectionKind,
          externalId: integrationSelections.externalId,
          externalLabel: integrationSelections.externalLabel,
        })
        .from(integrations)
        .leftJoin(integrationSelections, eq(integrationSelections.integrationId, integrations.id))
        .where(and(eq(integrations.teamId, teamId), integrationVisibility)),
      db
        .select({ cursor: integrationSyncState.cursor })
        .from(integrations)
        .innerJoin(
          integrationSelections,
          and(
            eq(integrationSelections.integrationId, integrations.id),
            eq(integrationSelections.selectionKind, 'github.org'),
          ),
        )
        .innerJoin(
          integrationSyncState,
          and(
            eq(integrationSyncState.integrationId, integrations.id),
            sql`${integrationSyncState.resourceType} = 'github.org:' || ${integrationSelections.externalId} || ':repos'`,
          ),
        )
        .where(
          and(
            eq(integrations.teamId, teamId),
            eq(integrations.provider, 'github'),
            integrationVisibility,
          ),
        ),
      db
        .select({
          chatId: telegramChatBindings.tgChatId,
          label: telegramChatBindings.title,
        })
        .from(telegramChatBindings)
        .where(eq(telegramChatBindings.teamId, teamId)),
      db
        .select({
          workspaceId: slackWorkspaces.slackTeamId,
          channelId: slackConversationBindings.slackConversationId,
          label: slackConversationBindings.title,
        })
        .from(slackConversationBindings)
        .innerJoin(slackWorkspaces, eq(slackConversationBindings.workspaceId, slackWorkspaces.id))
        .where(
          and(
            eq(slackConversationBindings.teamId, teamId),
            eq(slackConversationBindings.enabled, true),
            or(
              eq(slackConversationBindings.visibilityDefault, 'team'),
              eq(slackConversationBindings.boundByUserId, userId),
            ),
          ),
        ),
      db
        .select({
          source: rawEvents.source,
          provider,
          mondayBoardId,
          mondayBoardName,
          githubRepo,
          slackWorkspaceId,
          slackChannelId,
          slackChannelName,
          telegramChatId,
          telegramChatTitle,
        })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            visibilityFilter,
            activeRawEventFilter,
            inArray(rawEvents.source, ['integration', 'slack', 'telegram']),
          ),
        )
        .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
        .limit(RECENT_SOURCE_FACET_EVENT_LIMIT),
    ]);
    const [integrationRows, githubOrgExpansions, telegramBindings, slackBindings, recentEvents] =
      sourceFacetRows;

    for (const row of integrationRows) {
      add(`provider:${row.provider}`, {
        filter: { kind: 'provider', provider: row.provider },
        label: row.provider,
        eventCount: 0,
      });
      if (!row.selectionKind || !row.externalId) continue;
      if (row.provider === 'monday' && row.selectionKind === 'monday.board') {
        add(`monday:${row.externalId}`, {
          filter: { kind: 'monday_board', boardId: row.externalId },
          label: row.externalLabel ?? row.externalId,
          eventCount: 0,
        });
      } else if (row.provider === 'github' && row.selectionKind === 'github.repo') {
        add(`github:${row.externalId}`, {
          filter: { kind: 'github_repo', repo: row.externalId },
          label: row.externalLabel ?? row.externalId,
          eventCount: 0,
        });
      } else if (row.provider === 'slack' && row.selectionKind === 'slack.channel') {
        const workspaceId = row.externalAccountId ?? undefined;
        add(`slack:${workspaceId ?? ''}:${row.externalId}`, {
          filter: {
            kind: 'slack_channel',
            channelId: row.externalId,
            ...(workspaceId ? { workspaceId } : {}),
          },
          label: slackChannelDisplayLabel(row.externalLabel),
          eventCount: 0,
        });
      }
    }
    for (const row of githubOrgExpansions) {
      const repos =
        typeof row.cursor === 'object' &&
        row.cursor !== null &&
        'repos' in row.cursor &&
        Array.isArray(row.cursor.repos)
          ? row.cursor.repos
          : [];
      for (const repo of repos) {
        if (typeof repo !== 'string' || repo.length === 0) continue;
        add(`github:${repo}`, {
          filter: { kind: 'github_repo', repo },
          label: repo,
          eventCount: 0,
        });
      }
    }
    for (const row of slackBindings) {
      add(`slack:${row.workspaceId}:${row.channelId}`, {
        filter: {
          kind: 'slack_channel',
          workspaceId: row.workspaceId,
          channelId: row.channelId,
        },
        label: slackChannelDisplayLabel(row.label),
        eventCount: 0,
      });
    }
    for (const row of telegramBindings) {
      const chatId = String(row.chatId);
      add(`telegram:${chatId}`, {
        filter: { kind: 'telegram_chat', chatId },
        label: row.label ?? chatId,
        eventCount: 0,
      });
    }
    const eventLabelsSeen = new Set<string>();
    for (const row of recentEvents) {
      addTimelineSourceFacetFromEvent((key, facet, hasDisplayLabel) => {
        add(key, facet, hasDisplayLabel && !eventLabelsSeen.has(key));
        if (hasDisplayLabel) eventLabelsSeen.add(key);
      }, row);
    }

    return [...facets.values()].sort(
      (a, b) => b.eventCount - a.eventCount || a.label.localeCompare(b.label),
    );
  }

  function metadataPredicateCondition(
    predicate: NonNullable<TimelineMomentLookupPlan['metadataPredicates']>[number],
  ) {
    const value = predicate.equals;
    switch (predicate.path.join('.')) {
      case 'provider':
        return sql`${rawEvents.sourceMetadata} ->> 'provider' = ${value}`;
      case 'event_type':
        return sql`${rawEvents.sourceMetadata} ->> 'event_type' = ${value}`;
      case 'external_object_id':
        return sql`${rawEvents.sourceMetadata} ->> 'external_object_id' = ${value}`;
      case 'external_event_id':
        return sql`${rawEvents.sourceMetadata} ->> 'external_event_id' = ${value}`;
      case 'meeting_id':
        return sql`${rawEvents.sourceMetadata} ->> 'meeting_id' = ${value}`;
      case 'thread_root_id':
        return sql`${rawEvents.sourceMetadata} ->> 'thread_root_id' = ${value}`;
      case 'calendar_event_id':
        return sql`${rawEvents.sourceMetadata} ->> 'calendar_event_id' = ${value}`;
      case 'websiteScanId':
        return sql`${rawEvents.sourceMetadata} ->> 'websiteScanId' = ${value}`;
      case 'document_id':
        return sql`COALESCE(${rawEvents.sourceMetadata} ->> 'document_id', ${rawEvents.sourceMetadata} ->> 'documentId') = ${value}`;
      case 'action':
        return sql`${rawEvents.sourceMetadata} ->> 'action' = ${value}`;
      case 'tg_chat_id':
        return sql`${rawEvents.sourceMetadata} ->> 'tg_chat_id' = ${value}`;
      case 'tg_chat_title':
        return sql`${rawEvents.sourceMetadata} ->> 'tg_chat_title' = ${value}`;
      case 'ingest_webhook_id':
        return sql`${rawEvents.sourceMetadata} ->> 'ingest_webhook_id' = ${value}`;
      case 'slack_channel_id':
        return sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${value}`;
      case 'slack_channel_name':
        return sql`${rawEvents.sourceMetadata} ->> 'slack_channel_name' = ${value}`;
      case 'slack_thread_ts':
        return sql`${rawEvents.sourceMetadata} ->> 'slack_thread_ts' = ${value}`;
      case 'slack_message_ts':
        return sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${value}`;
      case 'workflow_name':
        return sql`${rawEvents.sourceMetadata} ->> 'workflow_name' = ${value}`;
      case 'content.github_workflow_name':
        return sql`POSITION(${`GitHub workflow "${value}"`} IN COALESCE(${rawEvents.contentText}, '')) > 0`;
      case 'github.type':
        return sql`${rawEvents.sourceMetadata} #>> '{github,type}' = ${value}`;
      case 'github.repo':
        return sql`${rawEvents.sourceMetadata} #>> '{github,repo}' = ${value}`;
      case 'github.head_branch':
        return sql`${rawEvents.sourceMetadata} #>> '{github,head_branch}' = ${value}`;
      case 'github.workflow_name':
        return sql`${rawEvents.sourceMetadata} #>> '{github,workflow_name}' = ${value}`;
      case 'github.pr_number':
        return sql`COALESCE(${rawEvents.sourceMetadata} #>> '{github,pr_number}', ${rawEvents.sourceMetadata} #>> '{github,number}') = ${value}`;
      case 'github.number':
        return sql`COALESCE(${rawEvents.sourceMetadata} #>> '{github,number}', ${rawEvents.sourceMetadata} #>> '{github,pr_number}') = ${value}`;
      case 'github.sha':
        return sql`COALESCE(${rawEvents.sourceMetadata} #>> '{github,sha}', ${rawEvents.sourceMetadata} #>> '{github,head_sha}') = ${value}`;
      case 'github.head_sha':
        return sql`COALESCE(${rawEvents.sourceMetadata} #>> '{github,head_sha}', ${rawEvents.sourceMetadata} #>> '{github,sha}') = ${value}`;
      case 'github.tag':
        return sql`${rawEvents.sourceMetadata} #>> '{github,tag}' = ${value}`;
      default:
        throw new Error(
          `Unsupported timeline moment metadata predicate: ${predicate.path.join('.')}`,
        );
    }
  }

  async function listEventsForMomentLookupBase(
    plan: TimelineMomentLookupPlan,
    includeUserVisibility: boolean,
  ): Promise<(typeof rawEvents.$inferSelect)[]> {
    const { preferredGroupKey, ...fallbackPlan } = plan;
    if (preferredGroupKey) {
      // A legacy calendar ID can also be the current occurrence ID. Fetch that
      // canonical group before capped notice history so every caller resolves it.
      const [canonical, fallback] = await Promise.all([
        listEventsForMomentLookupBase(
          {
            ...fallbackPlan,
            matchingGroupKey: preferredGroupKey,
            matchGroupAliases: false,
            limit: 1,
          },
          includeUserVisibility,
        ),
        listEventsForMomentLookupBase(fallbackPlan, includeUserVisibility),
      ]);
      return [...new Map([...canonical, ...fallback].map((row) => [row.id, row])).values()].slice(
        0,
        plan.limit,
      );
    }
    const conditions = [
      eq(rawEvents.teamId, teamId),
      activeRawEventFilter,
      eq(rawEvents.source, plan.source),
    ];
    if (includeUserVisibility && visibilityFilter) conditions.push(visibilityFilter);
    if (plan.from) conditions.push(gte(rawEvents.occurredAt, plan.from));
    if (plan.to) conditions.push(lt(rawEvents.occurredAt, plan.to));
    for (const predicate of plan.metadataPredicates ?? []) {
      conditions.push(metadataPredicateCondition(predicate));
    }
    for (const group of plan.metadataPredicateGroups ?? []) {
      const groupConditions = group.map(metadataPredicateCondition);
      if (groupConditions.length === 1) {
        const condition = groupConditions[0];
        if (condition) conditions.push(condition);
      } else if (groupConditions.length > 1) {
        const condition = or(...groupConditions);
        if (condition) conditions.push(condition);
      }
    }
    if (plan.matchingGroupKey) {
      const matches: (typeof rawEvents.$inferSelect)[] = [];
      let cursor: typeof rawEvents.$inferSelect | undefined;
      for (;;) {
        const rows: (typeof rawEvents.$inferSelect)[] = await db
          .select()
          .from(rawEvents)
          .where(
            and(
              ...conditions,
              cursor
                ? sql`(${rawEvents.occurredAt}, ${rawEvents.id}) < (${cursor.occurredAt}, ${cursor.id})`
                : undefined,
            ),
          )
          .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
          .limit(300);
        matches.push(
          ...rows.filter((event) =>
            timelineEventMatchesGroup(event, plan.matchingGroupKey ?? '', plan.matchGroupAliases),
          ),
        );
        if (matches.length >= plan.limit || rows.length < 300) return matches.slice(0, plan.limit);
        cursor = rows.at(-1);
      }
    }
    return db
      .select()
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(plan.limit);
  }

  async function listEventsForMomentLookups(
    plans: TimelineMomentLookupPlan[],
  ): Promise<(typeof rawEvents.$inferSelect)[]> {
    await ensureMember();
    if (plans.length === 0) return [];
    if (plans.some((plan) => plan.matchingGroupKey ?? plan.preferredGroupKey)) {
      const rows = await Promise.all(
        plans.map((plan) => listEventsForMomentLookupBase(plan, true)),
      );
      return [...new Map(rows.flat().map((row) => [row.id, row])).values()];
    }
    const planConditions = plans.map((plan) => {
      const conditions = [eq(rawEvents.source, plan.source)];
      if (plan.from) conditions.push(gte(rawEvents.occurredAt, plan.from));
      if (plan.to) conditions.push(lt(rawEvents.occurredAt, plan.to));
      for (const predicate of plan.metadataPredicates ?? []) {
        conditions.push(metadataPredicateCondition(predicate));
      }
      for (const group of plan.metadataPredicateGroups ?? []) {
        const groupConditions = group.map(metadataPredicateCondition);
        if (groupConditions.length === 1) {
          const condition = groupConditions[0];
          if (condition) conditions.push(condition);
        } else if (groupConditions.length > 1) {
          const condition = or(...groupConditions);
          if (condition) conditions.push(condition);
        }
      }
      return and(...conditions);
    });
    const combinedPlanCondition = or(
      ...planConditions.filter((condition) => condition !== undefined),
    );
    if (!combinedPlanCondition) return [];
    return db
      .select()
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          visibilityFilter,
          activeRawEventFilter,
          combinedPlanCondition,
        ),
      )
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(
        Math.min(
          plans.reduce((sum, plan) => sum + plan.limit, 0),
          5_000,
        ),
      );
  }

  async function listEventsForMomentLookup(
    plan: TimelineMomentLookupPlan,
  ): Promise<(typeof rawEvents.$inferSelect)[]> {
    await ensureMember();
    return listEventsForMomentLookupBase(plan, true);
  }

  async function listTeamEventsForMomentLookup(
    plan: TimelineMomentLookupPlan,
  ): Promise<(typeof rawEvents.$inferSelect)[]> {
    return listEventsForMomentLookupBase(plan, false);
  }

  return {
    listEventsPage,
    listAllEventsInWindow,
    getEvent,
    getEventsByIds: getEventsByIdsImpl,
    listIntegrationSearchEventIds: listIntegrationSearchEventIdsImpl,
    listEvents,
    listSourceFacets,
    listEventsForMomentLookup,
    listEventsForMomentLookups,
    // Pin cleanup must distinguish deleted moments from moments hidden from the current user.
    listTeamEventsForMomentLookup,
  };
}
