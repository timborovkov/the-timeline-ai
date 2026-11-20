import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

import type { TeamScope } from '@timeline/shared/team-scope';

import { authConfig } from '@/lib/auth.config';
import { reportHandledEvent } from '@/lib/sentry-report';

type PersistTurn = TeamScope['objects']['persistChatTurn'];
type Turn = Parameters<PersistTurn>[1];
const MAX_PLAINTEXT_BYTES = 3 * 1024 * 1024;
export const MAX_CHAT_RETRY_BYTES = 4 * 1024 * 1024 + 1024;
const RETRY_TTL_MS = 24 * 60 * 60_000;

export type ChatSaveResult =
  | { status: 'saved' | 'conflict'; sessionId: string }
  | { status: 'unavailable'; sessionId: string | null }
  | { status: 'retry'; sessionId: string; token: string };

interface Recovery {
  teamId: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
  turn: Turn;
}

function recoveryKey(): Buffer {
  const configured = authConfig.secret;
  const secret = Array.isArray(configured) ? configured[0] : configured;
  if (!secret) throw new Error('Auth secret is required for chat recovery');
  return createHash('sha256').update('timeline:chat-recovery:v1\0').update(secret).digest();
}

function seal(recovery: Recovery): string {
  const data = Buffer.from(JSON.stringify(recovery));
  if (data.length > MAX_PLAINTEXT_BYTES) throw new Error('Chat recovery payload is too large');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', recoveryKey(), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function openChatRecovery(
  token: string,
  identity: { teamId: string; userId: string },
): Recovery | null {
  if (token.length > MAX_CHAT_RETRY_BYTES || !/^[\w-]+$/.test(token)) return null;
  try {
    const data = Buffer.from(token, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', recoveryKey(), data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    const recovery = JSON.parse(
      Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(),
    ) as Recovery;
    if (
      recovery.teamId !== identity.teamId ||
      recovery.userId !== identity.userId ||
      recovery.expiresAt <= Date.now()
    )
      return null;
    return recovery;
  } catch {
    return null;
  }
}

export async function saveChatTurn(input: {
  scope: TeamScope;
  sessionId: string;
  expectedRevision: string | null;
  replace?: boolean;
  turn: Turn;
}): Promise<ChatSaveResult> {
  const { scope, sessionId } = input;
  const turn: Turn = {
    ...input.turn,
    save: { id: randomUUID(), expectedRevision: input.expectedRevision, replace: input.replace },
  };
  try {
    const result = await scope.objects.persistChatTurn(sessionId, turn);
    return { status: result === 'conflict' ? 'conflict' : 'saved', sessionId };
  } catch {
    reportHandledEvent({
      message: 'chat_turn_save_failed',
      surface: 'api',
      operation: 'chat_session_append',
      level: 'warning',
    });
    try {
      const token = seal({
        teamId: scope.teamId,
        userId: scope.userId,
        sessionId,
        expiresAt: Date.now() + RETRY_TTL_MS,
        turn,
      });
      return { status: 'retry', token, sessionId };
    } catch {
      return { status: 'unavailable', sessionId };
    }
  }
}
