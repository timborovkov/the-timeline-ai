import { chatMessages, chatSessions, type Db } from '@timeline/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { stableJson } from '#src/reconciliation/stable-json.js';

import type { TeamScopeCore } from '#src/team-scope.js';
import type { UIMessage } from 'ai';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
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
    if (!session) throw new Error('Session not found');
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
  return {
    async persistChatTurn(
      sessionId: string,
      input: {
        userMessage?: UIMessage | null;
        assistantMessage: UIMessage;
        metadata?: Record<string, unknown>;
      },
    ) {
      await scope.requireMembership();
      await db.transaction(async (tx) => {
        await lock(tx, sessionId);
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
      });
    },
    async claimChatApprovals(sessionId: string, submitted: UIMessage): Promise<UIMessage> {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        await lock(tx, sessionId);
        const row = await find(tx, sessionId, submitted.id);
        const [latestMessage] = await tx
          .select({ id: chatMessages.id })
          .from(chatMessages)
          .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.teamId, scope.teamId)))
          .orderBy(desc(chatMessages.sequence))
          .limit(1);
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
        await tx
          .update(chatMessages)
          .set({ content: { ...content, ui_message: result, approval_claimed: true } })
          .where(eq(chatMessages.id, row.id));
        return result;
      });
    },
  };
}
