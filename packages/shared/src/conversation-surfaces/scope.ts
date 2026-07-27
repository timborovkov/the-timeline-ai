import {
  type Db,
  chatMessages,
  chatSessions,
  chatSurfaceSessionLinks,
  chatSurfaceTurns,
  type chatSurfaceTurnStatus,
} from '@timeline/db';
import { type ModelMessage } from 'ai';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import {
  DIRECT_CONVERSATION_HISTORY_CHARACTER_LIMIT,
  DIRECT_CONVERSATION_HISTORY_MESSAGE_LIMIT,
  DIRECT_CONVERSATION_RATE_LIMIT_PER_MINUTE,
  type DirectAgentTurnRequest,
  type DirectConversationIdentity,
} from '#src/conversation-surfaces/types.js';
import { childLogger } from '#src/logger.js';
import { type TeamScopeCore } from '#src/team-scope.js';

type ConversationTurnStatus = (typeof chatSurfaceTurnStatus.enumValues)[number];
export type ConversationDbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
const log = childLogger('conversation-surfaces');

export interface SurfaceTurnRow {
  id: string;
  surface: string;
  externalEventId: string;
  externalMessageId: string;
  externalConversationKey: string;
  externalUserKey: string;
  teamId: string;
  userId: string;
  chatSessionId: string;
  questionText: string;
  answerText: string | null;
  status: ConversationTurnStatus;
  errorCode: string | null;
  requestedModelId: string | null;
  responseModelId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  answeredAt: Date | null;
  deliveredAt: Date | null;
  updatedAt: Date;
}

export type CreateSurfaceTurnResult =
  | { status: 'accepted'; turn: SurfaceTurnRow }
  | { status: 'duplicate'; turn: SurfaceTurnRow }
  | { status: 'busy' }
  | { status: 'rate_limited' };

const CHAT_TITLE_MAX_LENGTH = 48;

function normalizeTitle(question: string): string {
  const compact = question.replace(/\s+/g, ' ').trim();
  return (compact || 'New chat').slice(0, CHAT_TITLE_MAX_LENGTH).trim() || 'New chat';
}

function dedupeTitle(title: string, existing: string[]): string {
  const seen = new Set(existing.map((value) => value.toLowerCase()));
  if (!seen.has(title.toLowerCase())) return title;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const marker = ` ${suffix}`;
    const candidate = `${title.slice(0, CHAT_TITLE_MAX_LENGTH - marker.length).trim()}${marker}`;
    if (!seen.has(candidate.toLowerCase())) return candidate;
  }
  return `${title.slice(0, CHAT_TITLE_MAX_LENGTH - 4).trim()} ${Date.now().toString().slice(-3)}`;
}

export function directConversationTitle(question: string): string {
  return normalizeTitle(question);
}

function scopedTurnWhere(scope: TeamScopeCore, turnId: string) {
  return and(
    eq(chatSurfaceTurns.id, turnId),
    eq(chatSurfaceTurns.teamId, scope.teamId),
    eq(chatSurfaceTurns.userId, scope.userId),
  );
}

function textFromContent(role: 'user' | 'assistant', content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const record = content as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (role !== 'user') return null;
  const uiMessage = record.ui_message;
  if (!uiMessage || typeof uiMessage !== 'object') return null;
  const parts = (uiMessage as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .flatMap((part) =>
      part &&
      typeof part === 'object' &&
      (part as Record<string, unknown>).type === 'text' &&
      typeof (part as Record<string, unknown>).text === 'string'
        ? [(part as Record<string, unknown>).text as string]
        : [],
    )
    .join('\n')
    .trim();
  return text || null;
}

function boundedHistory(
  rows: { role: 'user' | 'assistant' | 'tool' | 'system'; content: unknown }[],
): ModelMessage[] {
  const messages = rows.flatMap<ModelMessage>((row) => {
    if (row.role !== 'user' && row.role !== 'assistant') return [];
    const content = textFromContent(row.role, row.content);
    return content ? [{ role: row.role, content }] : [];
  });
  while (
    messages.length > DIRECT_CONVERSATION_HISTORY_MESSAGE_LIMIT ||
    messages.reduce(
      (total, message) =>
        total + (typeof message.content === 'string' ? message.content.length : 0),
      0,
    ) > DIRECT_CONVERSATION_HISTORY_CHARACTER_LIMIT
  ) {
    messages.shift();
  }
  return messages;
}

async function existingSessionTitles(
  tx: ConversationDbTransaction,
  scope: TeamScopeCore,
): Promise<string[]> {
  const rows = await tx
    .select({ title: chatSessions.title })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.teamId, scope.teamId),
        eq(chatSessions.createdBy, scope.userId),
        isNull(chatSessions.archivedAt),
      ),
    );
  return rows.flatMap((row) => (row.title ? [row.title] : []));
}

async function resetSurfaceLink(
  tx: ConversationDbTransaction,
  link: {
    id: string;
    sessionId: string;
    teamId: string;
    userId: string;
  },
  errorCode: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(chatSurfaceTurns)
    .set({ status: 'cancelled', errorCode, updatedAt: now })
    .where(
      and(
        eq(chatSurfaceTurns.teamId, link.teamId),
        eq(chatSurfaceTurns.userId, link.userId),
        eq(chatSurfaceTurns.chatSessionId, link.sessionId),
        inArray(chatSurfaceTurns.status, [
          'queued',
          'processing',
          'answered',
          'failed',
          'timed_out',
        ]),
      ),
    );
  await tx
    .update(chatSessions)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(chatSessions.id, link.sessionId),
        eq(chatSessions.teamId, link.teamId),
        eq(chatSessions.createdBy, link.userId),
      ),
    );
  await tx
    .delete(chatSurfaceSessionLinks)
    .where(
      and(
        eq(chatSurfaceSessionLinks.id, link.id),
        eq(chatSurfaceSessionLinks.teamId, link.teamId),
        eq(chatSurfaceSessionLinks.userId, link.userId),
      ),
    );
}

function conversationLockKey(surface: string, externalConversationKey: string): string {
  return `surface-conversation:${surface}:${externalConversationKey}`;
}

async function lockConversation(
  tx: ConversationDbTransaction,
  surface: string,
  externalConversationKey: string,
): Promise<void> {
  const lockKey = conversationLockKey(surface, externalConversationKey);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

export async function resetSurfaceSessionInTransaction(
  tx: ConversationDbTransaction,
  identity: DirectConversationIdentity,
  errorCode = 'session_reset',
): Promise<string | null> {
  await lockConversation(tx, identity.surface, identity.externalConversationKey);
  const links = await tx
    .select({
      id: chatSurfaceSessionLinks.id,
      sessionId: chatSurfaceSessionLinks.chatSessionId,
      teamId: chatSurfaceSessionLinks.teamId,
      userId: chatSurfaceSessionLinks.userId,
    })
    .from(chatSurfaceSessionLinks)
    .where(
      and(
        eq(chatSurfaceSessionLinks.surface, identity.surface),
        eq(chatSurfaceSessionLinks.externalConversationKey, identity.externalConversationKey),
        eq(chatSurfaceSessionLinks.teamId, identity.teamId),
        eq(chatSurfaceSessionLinks.userId, identity.userId),
      ),
    )
    .limit(1);
  const link = links[0];
  if (!link) return null;
  await resetSurfaceLink(tx, link, errorCode);
  return link.sessionId;
}

export async function resetSurfaceSessionByIdInTransaction(
  tx: ConversationDbTransaction,
  input: { sessionId: string; teamId: string; userId: string; errorCode?: string },
): Promise<boolean> {
  const candidates = await tx
    .select({
      surface: chatSurfaceSessionLinks.surface,
      externalConversationKey: chatSurfaceSessionLinks.externalConversationKey,
    })
    .from(chatSurfaceSessionLinks)
    .where(
      and(
        eq(chatSurfaceSessionLinks.chatSessionId, input.sessionId),
        eq(chatSurfaceSessionLinks.teamId, input.teamId),
        eq(chatSurfaceSessionLinks.userId, input.userId),
      ),
    )
    .limit(1);
  const candidate = candidates[0];
  if (!candidate) return false;
  await lockConversation(tx, candidate.surface, candidate.externalConversationKey);
  const links = await tx
    .select({
      id: chatSurfaceSessionLinks.id,
      sessionId: chatSurfaceSessionLinks.chatSessionId,
      teamId: chatSurfaceSessionLinks.teamId,
      userId: chatSurfaceSessionLinks.userId,
    })
    .from(chatSurfaceSessionLinks)
    .where(
      and(
        eq(chatSurfaceSessionLinks.chatSessionId, input.sessionId),
        eq(chatSurfaceSessionLinks.teamId, input.teamId),
        eq(chatSurfaceSessionLinks.userId, input.userId),
      ),
    )
    .limit(1);
  const link = links[0];
  if (!link) return false;
  await resetSurfaceLink(tx, link, input.errorCode ?? 'session_archived');
  return true;
}

export async function resetSurfaceSessionsForTeamUserInTransaction(
  tx: ConversationDbTransaction,
  input: { teamId: string; userId: string; errorCode?: string },
): Promise<number> {
  const userLockKey = `surface-rate:${input.userId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userLockKey}, 0))`);
  const links = await tx
    .select({
      id: chatSurfaceSessionLinks.id,
      sessionId: chatSurfaceSessionLinks.chatSessionId,
      teamId: chatSurfaceSessionLinks.teamId,
      userId: chatSurfaceSessionLinks.userId,
      surface: chatSurfaceSessionLinks.surface,
      externalConversationKey: chatSurfaceSessionLinks.externalConversationKey,
    })
    .from(chatSurfaceSessionLinks)
    .where(
      and(
        eq(chatSurfaceSessionLinks.teamId, input.teamId),
        eq(chatSurfaceSessionLinks.userId, input.userId),
      ),
    )
    .orderBy(
      asc(chatSurfaceSessionLinks.surface),
      asc(chatSurfaceSessionLinks.externalConversationKey),
    );
  for (const link of links) {
    await lockConversation(tx, link.surface, link.externalConversationKey);
    await resetSurfaceLink(tx, link, input.errorCode ?? 'membership_removed');
  }
  return links.length;
}

async function persistTurnTranscript(
  tx: ConversationDbTransaction,
  scope: TeamScopeCore,
  turn: SurfaceTurnRow,
  answer: string,
  toolObservability?: unknown,
): Promise<void> {
  await tx.insert(chatMessages).values([
    {
      teamId: scope.teamId,
      sessionId: turn.chatSessionId,
      role: 'user',
      authorUserId: scope.userId,
      content: {
        ui_message: {
          id: `surface-turn:${turn.id}:user`,
          role: 'user',
          parts: [{ type: 'text', text: turn.questionText }],
        },
      },
    },
    {
      teamId: scope.teamId,
      sessionId: turn.chatSessionId,
      role: 'assistant',
      authorUserId: null,
      content: {
        text: answer,
        tool_calls: [],
        conversation_surface: turn.surface,
        surface_turn_id: turn.id,
        tool_observability: toolObservability ?? null,
      },
    },
  ]);
  await tx
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(chatSessions.id, turn.chatSessionId),
        eq(chatSessions.teamId, scope.teamId),
        eq(chatSessions.createdBy, scope.userId),
      ),
    );
}

export function createConversationSurfaceScope(db: Db, scope: TeamScopeCore) {
  function assertIdentity(identity: DirectConversationIdentity): void {
    if (identity.teamId !== scope.teamId || identity.userId !== scope.userId) {
      throw new Error('Conversation identity is outside the active team scope');
    }
  }

  async function getOrCreateSessionInTransaction(
    tx: ConversationDbTransaction,
    identity: DirectConversationIdentity,
    firstQuestion: string,
  ): Promise<{ id: string; created: boolean }> {
    const links = await tx
      .select({
        id: chatSurfaceSessionLinks.id,
        sessionId: chatSurfaceSessionLinks.chatSessionId,
        teamId: chatSurfaceSessionLinks.teamId,
        userId: chatSurfaceSessionLinks.userId,
        archivedAt: chatSessions.archivedAt,
      })
      .from(chatSurfaceSessionLinks)
      .innerJoin(chatSessions, eq(chatSessions.id, chatSurfaceSessionLinks.chatSessionId))
      .where(
        and(
          eq(chatSurfaceSessionLinks.surface, identity.surface),
          eq(chatSurfaceSessionLinks.externalConversationKey, identity.externalConversationKey),
        ),
      )
      .limit(1);
    const existing = links[0];
    if (
      existing?.teamId === scope.teamId &&
      existing.userId === scope.userId &&
      existing.archivedAt === null
    ) {
      return { id: existing.sessionId, created: false };
    }
    if (existing) {
      if (existing.userId === scope.userId) {
        await resetSurfaceLink(tx, existing, 'team_changed');
      } else {
        await tx.delete(chatSurfaceSessionLinks).where(eq(chatSurfaceSessionLinks.id, existing.id));
      }
    }

    const title = dedupeTitle(
      directConversationTitle(firstQuestion),
      await existingSessionTitles(tx, scope),
    );
    const sessions = await tx
      .insert(chatSessions)
      .values({
        teamId: scope.teamId,
        createdBy: scope.userId,
        surface: identity.surface,
        title,
      })
      .returning({ id: chatSessions.id });
    const session = sessions[0];
    if (!session) throw new Error('Failed to create direct conversation session');
    await tx.insert(chatSurfaceSessionLinks).values({
      surface: identity.surface,
      externalConversationKey: identity.externalConversationKey,
      teamId: scope.teamId,
      userId: scope.userId,
      chatSessionId: session.id,
    });
    log.info(
      {
        event: 'conversation_session_created',
        surface: identity.surface,
        teamId: scope.teamId,
        userId: scope.userId,
        sessionId: session.id,
        status: 'active',
      },
      'direct conversation session created',
    );
    return { id: session.id, created: true };
  }

  async function createTurn(request: DirectAgentTurnRequest): Promise<CreateSurfaceTurnResult> {
    await scope.requireMembership();
    assertIdentity(request);
    return db.transaction(async (tx) => {
      const userLockKey = `surface-rate:${scope.userId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userLockKey}, 0))`);
      await scope.requireMembership();
      await lockConversation(tx, request.surface, request.externalConversationKey);
      const duplicate = await tx
        .select()
        .from(chatSurfaceTurns)
        .where(
          and(
            eq(chatSurfaceTurns.surface, request.surface),
            eq(chatSurfaceTurns.externalEventId, request.externalEventId),
          ),
        )
        .limit(1);
      if (duplicate[0]) return { status: 'duplicate', turn: duplicate[0] };

      const since = new Date(Date.now() - 60_000);
      const recent = await tx
        .select({ id: chatSurfaceTurns.id })
        .from(chatSurfaceTurns)
        .where(
          and(eq(chatSurfaceTurns.userId, scope.userId), gte(chatSurfaceTurns.createdAt, since)),
        )
        .limit(DIRECT_CONVERSATION_RATE_LIMIT_PER_MINUTE);
      if (recent.length >= DIRECT_CONVERSATION_RATE_LIMIT_PER_MINUTE) {
        return { status: 'rate_limited' };
      }

      const active = await tx
        .select({ id: chatSurfaceTurns.id })
        .from(chatSurfaceTurns)
        .where(
          and(
            eq(chatSurfaceTurns.surface, request.surface),
            eq(chatSurfaceTurns.externalConversationKey, request.externalConversationKey),
            inArray(chatSurfaceTurns.status, ['queued', 'processing']),
          ),
        )
        .limit(1);
      if (active[0]) return { status: 'busy' };

      const session = await getOrCreateSessionInTransaction(tx, request, request.question);
      const rows = await tx
        .insert(chatSurfaceTurns)
        .values({
          surface: request.surface,
          externalEventId: request.externalEventId,
          externalMessageId: request.externalMessageId,
          externalConversationKey: request.externalConversationKey,
          externalUserKey: request.externalUserKey,
          teamId: scope.teamId,
          userId: scope.userId,
          chatSessionId: session.id,
          questionText: request.question.trim(),
        })
        .returning();
      const turn = rows[0];
      if (!turn) throw new Error('Failed to create direct conversation turn');
      return { status: 'accepted', turn };
    });
  }

  async function getTurn(turnId: string): Promise<SurfaceTurnRow | null> {
    await scope.requireMembership();
    const rows = await db
      .select()
      .from(chatSurfaceTurns)
      .where(scopedTurnWhere(scope, turnId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function claimTurn(
    turnId: string,
  ): Promise<
    | { status: 'claimed'; turn: SurfaceTurnRow }
    | { status: 'cached' | 'delivered' | 'terminal'; turn: SurfaceTurnRow }
    | { status: 'stale_processing'; turn: SurfaceTurnRow }
    | { status: 'missing' }
  > {
    await scope.requireMembership();
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(chatSurfaceTurns)
        .where(scopedTurnWhere(scope, turnId))
        .for('update')
        .limit(1);
      const turn = rows[0];
      if (!turn) return { status: 'missing' };
      if (turn.status === 'delivered' || turn.deliveredAt) return { status: 'delivered', turn };
      if (turn.status === 'cancelled') return { status: 'terminal', turn };
      if (turn.answerText) return { status: 'cached', turn };
      if (turn.status === 'processing') {
        const failed = await tx
          .update(chatSurfaceTurns)
          .set({ status: 'failed', errorCode: 'stale_processing', updatedAt: new Date() })
          .where(eq(chatSurfaceTurns.id, turn.id))
          .returning();
        return { status: 'stale_processing', turn: failed[0] ?? turn };
      }
      if (turn.status !== 'queued') return { status: 'terminal', turn };
      const claimed = await tx
        .update(chatSurfaceTurns)
        .set({ status: 'processing', startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(chatSurfaceTurns.id, turn.id), eq(chatSurfaceTurns.status, 'queued')))
        .returning();
      return claimed[0]
        ? { status: 'claimed', turn: claimed[0] }
        : { status: 'stale_processing', turn };
    });
  }

  async function recentHistory(sessionId: string): Promise<ModelMessage[]> {
    await scope.requireMembership();
    const session = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.teamId, scope.teamId),
          eq(chatSessions.createdBy, scope.userId),
          isNull(chatSessions.archivedAt),
        ),
      )
      .limit(1);
    if (!session[0]) return [];
    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.teamId, scope.teamId),
          eq(chatMessages.sessionId, sessionId),
          inArray(chatMessages.role, ['user', 'assistant']),
        ),
      )
      .orderBy(desc(chatMessages.sequence))
      .limit(100);
    return boundedHistory(rows.reverse());
  }

  async function storeAnswer(input: {
    turnId: string;
    answer: string;
    requestedModelId?: string;
    responseModelId?: string;
    toolObservability?: unknown;
  }): Promise<boolean> {
    await scope.requireMembership();
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(chatSurfaceTurns)
        .set({
          answerText: input.answer,
          status: 'answered',
          errorCode: null,
          requestedModelId: input.requestedModelId ?? null,
          responseModelId: input.responseModelId ?? null,
          answeredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(scopedTurnWhere(scope, input.turnId), eq(chatSurfaceTurns.status, 'processing')))
        .returning();
      const turn = rows[0];
      if (!turn) return false;
      await persistTurnTranscript(tx, scope, turn, input.answer, input.toolObservability);
      return true;
    });
  }

  async function cacheFailure(
    turnId: string,
    input: {
      status: 'timed_out' | 'failed';
      errorCode: string;
      answerText: string;
    },
  ): Promise<void> {
    await scope.requireMembership();
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(chatSurfaceTurns)
        .set({
          status: input.status,
          errorCode: input.errorCode,
          answerText: input.answerText,
          answeredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            scopedTurnWhere(scope, turnId),
            inArray(chatSurfaceTurns.status, ['queued', 'processing', 'failed', 'timed_out']),
            isNull(chatSurfaceTurns.answerText),
          ),
        )
        .returning();
      const turn = rows[0];
      if (turn) await persistTurnTranscript(tx, scope, turn, input.answerText);
    });
  }

  async function markDelivered(turnId: string): Promise<void> {
    await scope.requireMembership();
    const rows = await db
      .select({ status: chatSurfaceTurns.status })
      .from(chatSurfaceTurns)
      .where(scopedTurnWhere(scope, turnId))
      .limit(1);
    const status = rows[0]?.status;
    if (!status) return;
    await db
      .update(chatSurfaceTurns)
      .set({
        status: status === 'answered' ? 'delivered' : status,
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(scopedTurnWhere(scope, turnId));
  }

  async function resetSession(identity: DirectConversationIdentity): Promise<boolean> {
    await scope.requireMembership();
    assertIdentity(identity);
    return db.transaction(async (tx) => {
      const sessionId = await resetSurfaceSessionInTransaction(tx, identity);
      if (!sessionId) return false;
      log.info(
        {
          event: 'conversation_session_reset',
          surface: identity.surface,
          teamId: scope.teamId,
          userId: scope.userId,
          sessionId,
          status: 'archived',
        },
        'direct conversation session reset',
      );
      return true;
    });
  }

  return {
    createTurn,
    getTurn,
    claimTurn,
    recentHistory,
    storeAnswer,
    cacheFailure,
    markDelivered,
    resetSession,
  };
}

export async function resolveSurfaceTurnScope(
  db: Db,
  turnId: string,
): Promise<{ teamId: string; userId: string } | null> {
  const rows = await db
    .select({ teamId: chatSurfaceTurns.teamId, userId: chatSurfaceTurns.userId })
    .from(chatSurfaceTurns)
    .where(eq(chatSurfaceTurns.id, turnId))
    .limit(1);
  return rows[0] ?? null;
}
