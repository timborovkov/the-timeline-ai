'use server';

import type { ChatContextRef } from '@timeline/shared/chat-context';
import { type UIMessage } from 'ai';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { hydrateChatSessionMessages } from '@/lib/chat-session';
import { publicActionError } from '@/lib/public-error';
import { runSentryServerAction } from '@/lib/sentry-action';

interface LoadChatSessionActionResult {
  ok: boolean;
  error?: string;
  messages?: UIMessage[];
  contextTrail?: ChatContextRef[];
}

export async function archiveChatSessionAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('archive_chat_session', async () => {
    const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.objects.archiveChatSession(parsed.data.sessionId);
      revalidatePath('/app/chat');
      return { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'archive_chat_session',
          fallback: 'Failed to archive session.',
        }),
      };
    }
  });
}

export async function unpinChatSessionAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('unpin_chat_session', async () => {
    const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.objects.linkChatSessionToObject(parsed.data.sessionId, null);
      revalidatePath('/app/chat');
      return { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'unpin_chat_session',
          fallback: 'Failed to unpin chat session.',
        }),
      };
    }
  });
}

export async function loadChatSessionAction(input: unknown): Promise<LoadChatSessionActionResult> {
  return runSentryServerAction('load_chat_session_messages', async () => {
    const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { ok: false, error: r.error };
    try {
      const loaded = await r.scope.objects.getChatSession(parsed.data.sessionId);
      if (!loaded) return { ok: false, error: 'Session not found' };
      return {
        ok: true,
        messages: hydrateChatSessionMessages(loaded),
        contextTrail: loaded.session?.contextTrail ?? [],
      };
    } catch (err) {
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'load_chat_session_messages',
          fallback: 'Failed to load chat session.',
        }),
      };
    }
  });
}
