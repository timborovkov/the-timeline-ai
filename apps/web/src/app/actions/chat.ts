'use server';

import { objects, withTeam } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(UUID_RE, 'Invalid id');

interface ActionState {
  error?: string;
  ok?: boolean;
}

type ResolvedScope =
  | { ok: false; error: string }
  | { ok: true; scope: ReturnType<typeof withTeam> };

async function resolveScope(): Promise<ResolvedScope> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { ok: false, error: 'No active team' };
  return { ok: true, scope: withTeam(db, active.teamId, session.user.id) };
}

export async function archiveChatSessionAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  await objects.archiveChatSession(db, r.scope, parsed.data.sessionId);
  revalidatePath('/app/chat');
  return { ok: true };
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
