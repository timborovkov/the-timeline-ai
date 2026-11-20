import { createHash, randomUUID } from 'node:crypto';

import { chatMessages, chatSessions, type Db } from '@timeline/db';
import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { stableJson } from '#src/reconciliation/stable-json.js';
import type { TeamScopeCore } from '#src/team-scope.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ChatTurnInput {
  userMessage?: UIMessage | null;
  assistantMessage: UIMessage;
  metadata?: Record<string, unknown>;
  approvalClaimId?: string;
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
  approval_claim_id?: string | null;
  approval_steps?: Record<string, ApprovalStepState>;
  [key: string]: unknown;
}

export type ApprovalStepState =
  'queued' | 'running' | 'completed' | 'failed' | 'needs-check' | 'declined';

export interface ApprovalStepKey {
  messageId: string;
  toolCallId: string;
  claimId: string;
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
  async function findLatestAssistant(tx: Tx, sessionId: string, messageId: string) {
    const [row] = await tx
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.teamId, scope.teamId)))
      .orderBy(desc(chatMessages.sequence))
      .limit(1);
    const content = row?.content as Partial<TurnContent> | undefined;
    if (row?.role !== 'assistant' || content?.version !== 2 || content.ui_message?.id !== messageId)
      throw new Error('Approval no longer available');
    return { row, content: { ...content, version: 2 as const, ui_message: content.ui_message } };
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
          const previous = existing?.content as TurnContent | undefined;
          if (input.approvalClaimId && previous?.approval_claim_id !== input.approvalClaimId)
            continue;
          const approvalSteps = previous?.approval_steps
            ? { ...previous.approval_steps }
            : undefined;
          const assistantMessage =
            approvalSteps && previous
              ? withSavedApprovalOutcomes(message, previous, approvalSteps)
              : message;
          const content: TurnContent = {
            ...previous,
            ...(message.role === 'assistant' ? input.metadata : {}),
            ...(approvalSteps && { approval_steps: approvalSteps }),
            ...(message.role === 'assistant' && input.save ? { turn_save_id: input.save.id } : {}),
            version: 2,
            ui_message: assistantMessage,
            text: assistantMessage.parts
              .flatMap((p) => (p.type === 'text' ? [p.text] : []))
              .join('\n'),
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
    async claimChatApprovals(
      sessionId: string,
      submitted: UIMessage,
      claimId: string = randomUUID(),
    ): Promise<{ message: UIMessage; revision: string | null }> {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        if (!(await lock(tx, sessionId))) throw new Error('Session not found');
        const { row, content } = await findLatestAssistant(tx, sessionId, submitted.id);
        const saved = content.ui_message;
        if (
          Object.values(content.approval_steps ?? {}).some(
            (phase) => phase === 'running' || phase === 'needs-check',
          )
        )
          throw new Error('Approval outcome needs checking');
        const pending = saved.parts.filter((p) => 'state' in p && p.state === 'approval-requested');
        const decisions = submitted.parts.filter(
          (p) => 'state' in p && p.state === 'approval-responded',
        );
        if (!pending.length || pending.length !== decisions.length)
          throw new Error('Approval no longer available');
        const result = structuredClone(saved);
        const steps = { ...content.approval_steps };
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
          steps[decision.toolCallId] = decision.approval.approved ? 'queued' : 'declined';
        }
        // A claim is durable before execution. An interrupted claim is never automatically retried.
        const claimed = {
          ...content,
          ui_message: result,
          approval_claimed: true,
          approval_claim_id: claimId,
          approval_steps: steps,
        };
        await tx.update(chatMessages).set({ content: claimed }).where(eq(chatMessages.id, row.id));
        return { message: result, revision: revision({ id: row.id, content: claimed }) };
      });
    },

    async startChatApprovalStep(
      sessionId: string,
      key: ApprovalStepKey,
      tool: { name: string; input: unknown },
    ): Promise<boolean> {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        if (!(await lock(tx, sessionId))) return false;
        const { row, content } = await findLatestAssistant(tx, sessionId, key.messageId);
        if (
          content.approval_claim_id !== key.claimId ||
          content.approval_steps?.[key.toolCallId] !== 'queued'
        )
          return false;
        const part = content.ui_message.parts.find(
          (part) => isToolUIPart(part) && part.toolCallId === key.toolCallId,
        );
        if (
          !part ||
          !isToolUIPart(part) ||
          part.state !== 'approval-responded' ||
          !part.approval.approved ||
          getToolName(part) !== tool.name ||
          stableJson(part.input) !== stableJson(tool.input)
        )
          return false;
        await tx
          .update(chatMessages)
          .set({
            content: {
              ...content,
              approval_steps: { ...content.approval_steps, [key.toolCallId]: 'running' },
            },
          })
          .where(eq(chatMessages.id, row.id));
        return true;
      });
    },

    async finishChatApprovalStep(
      sessionId: string,
      key: ApprovalStepKey,
      status: 'completed' | 'failed' | 'needs-check',
      output: unknown,
    ): Promise<void> {
      await scope.requireMembership();
      await db.transaction(async (tx) => {
        if (!(await lock(tx, sessionId))) throw new Error('Approval step unavailable');
        const row = await find(tx, sessionId, key.messageId);
        const content = row?.content as TurnContent | undefined;
        if (
          !row ||
          content?.approval_claim_id !== key.claimId ||
          content.approval_steps?.[key.toolCallId] !== 'running'
        )
          throw new Error('Approval step unavailable');
        const message = structuredClone(content.ui_message);
        const part = message.parts.find(
          (part) => isToolUIPart(part) && part.toolCallId === key.toolCallId,
        );
        if (!part) throw new Error('Approval step unavailable');
        if (status !== 'needs-check') Object.assign(part, { state: 'output-available', output });
        await tx
          .update(chatMessages)
          .set({
            content: {
              ...content,
              ui_message: message,
              approval_steps: { ...content.approval_steps, [key.toolCallId]: status },
            },
          })
          .where(eq(chatMessages.id, row.id));
      });
    },

    async prepareChatApprovalResume(sessionId: string, messageId: string): Promise<UIMessage> {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        if (!(await lock(tx, sessionId))) throw new Error('Session not found');
        const { row, content } = await findLatestAssistant(tx, sessionId, messageId);
        const message = structuredClone(content.ui_message);
        const phases = Object.values(content.approval_steps ?? {});
        if (
          !phases.includes('queued') ||
          phases.some((phase) => phase !== 'queued' && phase !== 'completed') ||
          message.parts.some((part) => isToolUIPart(part) && part.state === 'approval-requested')
        )
          throw new Error('Approval cannot be resumed');
        let prepared = 0;
        for (const part of message.parts) {
          if (
            !isToolUIPart(part) ||
            part.state !== 'approval-responded' ||
            content.approval_steps?.[part.toolCallId] !== 'queued'
          )
            continue;
          Object.assign(part, { state: 'approval-requested', approval: { id: randomUUID() } });
          prepared += 1;
        }
        if (prepared !== phases.filter((phase) => phase === 'queued').length)
          throw new Error('Approval cannot be resumed');
        await tx
          .update(chatMessages)
          .set({
            content: { ...content, ui_message: message, approval_claim_id: null },
          })
          .where(eq(chatMessages.id, row.id));
        return message;
      });
    },
  };
}

function withSavedApprovalOutcomes(
  message: UIMessage,
  previous: TurnContent,
  steps: Record<string, ApprovalStepState>,
): UIMessage {
  const parts = [...message.parts];
  for (const saved of previous.ui_message.parts) {
    if (!isToolUIPart(saved) || !steps[saved.toolCallId]) continue;
    const index = parts.findIndex(
      (part) => isToolUIPart(part) && part.toolCallId === saved.toolCallId,
    );
    const streamed = parts[index];
    if (
      steps[saved.toolCallId] === 'queued' &&
      streamed &&
      isToolUIPart(streamed) &&
      streamed.state === 'output-error'
    ) {
      // SDK validation can fail before the executable tool is called.
      steps[saved.toolCallId] = 'failed';
      continue;
    }
    // The server checkpoint is authoritative even if the stream aborts before emitting a result.
    if (index === -1) parts.push(saved);
    else parts[index] = saved;
  }
  return { ...message, parts };
}
