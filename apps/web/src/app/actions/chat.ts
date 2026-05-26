'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';

export async function archiveChatSessionAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    await r.scope.objects.archiveChatSession(parsed.data.sessionId);
    revalidatePath('/app/chat');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to archive session' };
  }
}

export async function unpinChatSessionAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    await r.scope.objects.linkChatSessionToObject(parsed.data.sessionId, null);
    revalidatePath('/app/chat');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to unpin' };
  }
}
