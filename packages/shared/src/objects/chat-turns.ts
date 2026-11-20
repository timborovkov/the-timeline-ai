import { createHash } from 'node:crypto';

import { chatMessages, chatSessions, type Db } from '@timeline/db';
import type { UIMessage } from 'ai';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { stableJson } from '#src/reconciliation/stable-json.js';
import type { TeamScopeCore } from '#src/team-scope.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ChatTurnInput {
  userMessage?: UIMessage | null;
  assistantMessage: UIMessage;
  metadata?: Record<string, unknown>;
  save?: { id: string; expectedRevision: string | null; replace?: boolean };
}

function revision(row: { id: string; content: unknown } | undefined): string | null {
  return row
    ? createHash('sha256')
        .update(stableJson([row.id, row.content]))
        .digest('hex')
    : null;
}
interface TurnContent {
  version: 2;
  ui_message: UIMessage;
  [key: string]: unknown;
}

/** UI turns and approval claims share the owner-scoped session row lock. */
export function createChatTurnScope(db: Db, scope: TeamScopeCore) {
  async function lock(tx: Tx, sessionId: string) {
    const [session] = await tx
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
      .for('update');
    return Boolean(session);
  }
  async function find(tx: Tx, sessionId: string, messageId: string) {
    const [row] = await tx
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, sessionId),
          eq(chatMessages.teamId, scope.teamId),
          sql`${chatMessages.content}->'ui_message'->>'id' = ${messageId}`,
        ),
      )
      .limit(1);
    return row;
  }
  async function latest(tx: Tx, sessionId: string) {
    const [row] = await tx
      .select({ id: chatMessages.id, content: chatMessages.content })
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.teamId, scope.teamId)))
      .orderBy(desc(chatMessages.sequence))
      .limit(1);
    return row;
  }

  return {
    async chatTurnRevision(sessionId: string) {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        if (!(await lock(tx, sessionId))) throw new Error('Session not found');
        return revision(await latest(tx, sessionId));
      });
    },
    async persistChatTurn(sessionId: string, input: ChatTurnInput): Promise<'saved' | 'conflict'> {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        if (!(await lock(tx, sessionId))) {
          if (input.save) return 'conflict';
          throw new Error('Session not found');
        }
        if (input.save) {
          const existing = await find(tx, sessionId, input.assistantMessage.id);
          if ((existing?.content as TurnContent | undefined)?.turn_save_id === input.save.id)
            return 'saved';
          const expectedHead = input.save.replace ? existing : await latest(tx, sessionId);
          if (
            (input.save.replace && !existing) ||
            revision(expectedHead) !== input.save.expectedRevision
          )
            return 'conflict';
        }
        const messages = [input.userMessage, input.assistantMessage].filter((m): m is UIMessage =>
          Boolean(m),
        );
        for (const message of messages) {
          if (message.role !== 'user' && message.role !== 'assistant')
            throw new Error('Invalid chat role');
          const existing = await find(tx, sessionId, message.id);
          if (existing && existing.role !== message.role)
            throw new Error('Message identity conflict');
          if (existing && message.role === 'user') continue;
          const content: TurnContent = {
            ...(message.role === 'assistant' ? input.metadata : {}),
            ...(message.role === 'assistant' && input.save ? { turn_save_id: input.save.id } : {}),
            version: 2,
            ui_message: message,
            text: message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n'),
          };
          if (existing) {
            await tx.update(chatMessages).set({ content }).where(eq(chatMessages.id, existing.id));
          } else {
            await tx.insert(chatMessages).values({
              teamId: scope.teamId,
              sessionId,
              role: message.role,
              authorUserId: message.role === 'user' ? scope.userId : null,
              content,
            });
          }
        }
        await tx
          .update(chatSessions)
          .set({ updatedAt: new Date() })
          .where(eq(chatSessions.id, sessionId));
        return 'saved';
      });
    },
    async claimChatApprovals(sessionId: string, submitted: UIMessage) {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        if (!(await lock(tx, sessionId))) throw new Error('Session not found');
        const row = await find(tx, sessionId, submitted.id);
        const latestMessage = await latest(tx, sessionId);
        if (!row || latestMessage?.id !== row.id) throw new Error('Approval no longer available');
        const content = row.content as TurnContent | undefined;
        const saved = content?.ui_message;
        if (row.role !== 'assistant' || saved?.role !== 'assistant')
          throw new Error('Approval no longer available');
        const pending = saved.parts.filter((p) => 'state' in p && p.state === 'approval-requested');
        const decisions = submitted.parts.filter(
          (p) => 'state' in p && p.state === 'approval-responded',
        );
        if (!pending.length || pending.length !== decisions.length)
          throw new Error('Approval no longer available');
        const result = structuredClone(saved);
        for (const decision of decisions) {
          if (
            !('toolCallId' in decision) ||
            !('approval' in decision) ||
            typeof decision.approval.approved !== 'boolean'
          )
            throw new Error('Invalid approval');
          const part = result.parts.find(
            (p) => 'toolCallId' in p && p.toolCallId === decision.toolCallId,
          );
          if (
            !part ||
            !('state' in part) ||
            part.state !== 'approval-requested' ||
            !('approval' in part) ||
            part.approval.id !== decision.approval.id ||
            part.type !== decision.type ||
            ('toolName' in part &&
              (!('toolName' in decision) || part.toolName !== decision.toolName)) ||
            stableJson(part.input) !== stableJson(decision.input)
          )
            throw new Error('Approval does not match saved action');
          Object.assign(part, {
            state: 'approval-responded',
            approval: {
              ...part.approval,
              approved: decision.approval.approved,
              ...(decision.approval.reason ? { reason: decision.approval.reason } : {}),
            },
          });
        }
        // A claim is durable before execution. An interrupted claim is never automatically retried.
        const claimed = { ...content, ui_message: result, approval_claimed: true };
        await tx.update(chatMessages).set({ content: claimed }).where(eq(chatMessages.id, row.id));
        return { message: result, revision: revision({ id: row.id, content: claimed }) };
      });
    },
  };
}
