'use server';

import { type UIMessage } from 'ai';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { hydrateChatSessionMessages } from '@/lib/chat-session';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

interface LoadChatSessionActionResult {
  ok: boolean;
  error?: string;
  messages?: UIMessage[];
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
      reportCaughtError(err, { surface: 'server_action', operation: 'archive_chat_session' });
      return { error: err instanceof Error ? err.message : 'Failed to archive session' };
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
      reportCaughtError(err, { surface: 'server_action', operation: 'unpin_chat_session' });
      return { error: err instanceof Error ? err.message : 'Failed to unpin' };
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
      return { ok: true, messages: hydrateChatSessionMessages(loaded) };
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'load_chat_session_messages',
      });
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to load chat session',
      };
    }
  });
}
