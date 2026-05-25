'use server';

import { objects } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { db } from '@/lib/db';

export async function archiveChatSessionAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    await objects.archiveChatSession(db, r.scope, parsed.data.sessionId);
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
    await objects.linkChatSessionToObject(db, r.scope, parsed.data.sessionId, null);
    revalidatePath('/app/chat');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to unpin' };
  }
}
