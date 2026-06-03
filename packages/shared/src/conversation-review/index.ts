import { type Db, entities, factEntities, facts, rawEvents } from '@timeline/db';
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';

export const CONVERSATION_REVIEW_DEBOUNCE_MS = 10 * 60 * 1000;
export const CONVERSATION_WINDOW_DAYS = 7;
export const CONVERSATION_WINDOW_LIMIT = 100;
export const LINKED_CONTEXT_LIMIT = 20;

type Metadata = Record<string, unknown>;

export interface ConversationIdentity {
  key: string;
  source: 'telegram' | 'slack';
  kind: 'telegram_chat' | 'slack_thread' | 'slack_conversation';
}

export interface ConversationRawEvent {
  id: string;
  teamId: string;
  source: string;
  contentText: string | null;
  occurredAt: Date;
  visibility: 'team' | 'private' | 'specific_users';
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
  sourceMetadata: unknown;
}

export interface ConversationEvidenceEvent {
  id: string;
  occurredAt: Date;
  contentText: string;
  sourceMetadata: unknown;
}

export interface ConversationLinkedContextEvent extends ConversationEvidenceEvent {
  source: string;
  linkedObjects: { id: string; name: string; type: string }[];
}

function metadataObject(value: unknown): Metadata {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Metadata) : {};
}

function metadataString(meta: Metadata, key: string): string | null {
  const value = meta[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function conversationIdentityForRawEvent(
  row: Pick<ConversationRawEvent, 'teamId' | 'source' | 'sourceMetadata'>,
): ConversationIdentity | null {
  const meta = metadataObject(row.sourceMetadata);
  if (row.source === 'telegram') {
    const chatId = metadataString(meta, 'tg_chat_id');
    if (!chatId) return null;
    return {
      key: `telegram:${row.teamId}:chat:${chatId}`,
      source: 'telegram',
      kind: 'telegram_chat',
    };
  }
  if (row.source === 'slack') {
    const workspaceId = metadataString(meta, 'slack_workspace_id');
    const channelId = metadataString(meta, 'slack_channel_id');
    if (!workspaceId || !channelId) return null;
    const threadTs = metadataString(meta, 'slack_thread_ts');
    const messageTs = metadataString(meta, 'slack_message_ts');
    if (threadTs && threadTs !== messageTs) {
      return {
        key: `slack:${row.teamId}:${workspaceId}:${channelId}:thread:${threadTs}`,
        source: 'slack',
        kind: 'slack_thread',
      };
    }
    return {
      key: `slack:${row.teamId}:${workspaceId}:${channelId}`,
      source: 'slack',
      kind: 'slack_conversation',
    };
  }
  return null;
}

function conversationCondition(identity: ConversationIdentity) {
  const [, teamId] = identity.key.split(':');
  void teamId;
  if (identity.source === 'telegram') {
    const chatId = identity.key.split(':').at(-1);
    return and(
      eq(rawEvents.source, 'telegram'),
      sql`${rawEvents.sourceMetadata} ->> 'tg_chat_id' = ${chatId}`,
    );
  }
  const parts = identity.key.split(':');
  const workspaceId = parts[2];
  const channelId = parts[3];
  const threadTs = identity.kind === 'slack_thread' ? parts.at(-1) : null;
  const base = [
    eq(rawEvents.source, 'slack'),
    sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${workspaceId}`,
    sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${channelId}`,
  ];
  if (threadTs) {
    const threadCondition = or(
      sql`${rawEvents.sourceMetadata} ->> 'slack_thread_ts' = ${threadTs}`,
      sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${threadTs}`,
    );
    if (threadCondition) base.push(threadCondition);
  }
  return and(...base);
}

export function quietUntilFor(date = new Date()): Date {
  return new Date(date.getTime() + CONVERSATION_REVIEW_DEBOUNCE_MS);
}

export async function buildConversationEvidenceWindow(
  db: Db,
  args: {
    teamId: string;
    identity: ConversationIdentity;
    anchorOccurredAt: Date;
    limit?: number;
  },
): Promise<ConversationEvidenceEvent[]> {
  const from = new Date(args.anchorOccurredAt);
  from.setUTCDate(from.getUTCDate() - CONVERSATION_WINDOW_DAYS);
  const rows = await db
    .select({
      id: rawEvents.id,
      occurredAt: rawEvents.occurredAt,
      contentText: rawEvents.contentText,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, args.teamId),
        eq(rawEvents.visibility, 'team'),
        isNotNull(rawEvents.contentText),
        gte(rawEvents.occurredAt, from),
        lte(rawEvents.occurredAt, args.anchorOccurredAt),
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        conversationCondition(args.identity),
      ),
    )
    .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
    .limit(args.limit ?? CONVERSATION_WINDOW_LIMIT);

  return rows
    .reverse()
    .map((row) => ({
      ...row,
      contentText: row.contentText?.trim() ?? '',
    }))
    .filter((row) => row.contentText.length > 0);
}

export async function buildLinkedContextWindow(
  db: Db,
  args: {
    teamId: string;
    identity: ConversationIdentity;
    evidenceWindow: ConversationEvidenceEvent[];
    limit?: number;
  },
): Promise<ConversationLinkedContextEvent[]> {
  const evidenceIds = args.evidenceWindow.map((event) => event.id);
  if (evidenceIds.length === 0) return [];

  const linkedEntityRows = await db
    .selectDistinct({ entityId: factEntities.entityId })
    .from(factEntities)
    .innerJoin(facts, eq(facts.id, factEntities.factId))
    .where(and(eq(facts.teamId, args.teamId), inArray(facts.rawEventId, evidenceIds)));
  const entityIds = linkedEntityRows.map((row) => row.entityId);
  if (entityIds.length === 0) return [];

  const rows = await db
    .select({
      id: rawEvents.id,
      occurredAt: rawEvents.occurredAt,
      source: rawEvents.source,
      contentText: rawEvents.contentText,
      sourceMetadata: rawEvents.sourceMetadata,
      entityId: entities.id,
      entityName: entities.canonicalName,
      entityType: entities.type,
    })
    .from(factEntities)
    .innerJoin(facts, eq(facts.id, factEntities.factId))
    .innerJoin(rawEvents, eq(rawEvents.id, facts.rawEventId))
    .innerJoin(entities, eq(entities.id, factEntities.entityId))
    .where(
      and(
        eq(facts.teamId, args.teamId),
        eq(rawEvents.teamId, args.teamId),
        eq(rawEvents.visibility, 'team'),
        ne(rawEvents.source, args.identity.source),
        isNotNull(rawEvents.contentText),
        inArray(factEntities.entityId, entityIds),
        notInArray(rawEvents.id, evidenceIds),
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    )
    .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
    .limit(args.limit ?? LINKED_CONTEXT_LIMIT * 3);

  const byEvent = new Map<string, ConversationLinkedContextEvent>();
  for (const row of rows) {
    const contentText = row.contentText?.trim();
    if (!contentText) continue;
    const existing = byEvent.get(row.id);
    if (existing) {
      if (!existing.linkedObjects.some((object) => object.id === row.entityId)) {
        existing.linkedObjects.push({
          id: row.entityId,
          name: row.entityName,
          type: row.entityType,
        });
      }
      continue;
    }
    byEvent.set(row.id, {
      id: row.id,
      occurredAt: row.occurredAt,
      source: row.source,
      contentText,
      sourceMetadata: row.sourceMetadata,
      linkedObjects: [{ id: row.entityId, name: row.entityName, type: row.entityType }],
    });
  }

  return Array.from(byEvent.values())
    .slice(0, args.limit ?? LINKED_CONTEXT_LIMIT)
    .reverse();
}
