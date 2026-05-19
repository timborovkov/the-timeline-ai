'use server';

import { telegramChatBindings, telegramLinkTokens } from '@timeline/db';
import { randomToken, withTeam } from '@timeline/shared';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface GenerateLinkTokenState {
  error?: string;
  token?: string;
  scope?: 'personal' | 'group';
  expiresAt?: string;
}

async function generateLinkTokenAction(
  scope: 'personal' | 'group',
  _prev: GenerateLinkTokenState,
  _formData: FormData,
): Promise<GenerateLinkTokenState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  const teamScope = withTeam(db, active.teamId, session.user.id);
  try {
    await teamScope.requireMembership(scope === 'group' ? 'admin' : 'member');
  } catch {
    return { error: scope === 'group' ? 'Only admins can issue group tokens' : 'Not a member' };
  }

  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
  await db.insert(telegramLinkTokens).values({
    token,
    teamId: active.teamId,
    scope,
    issuedByUserId: session.user.id,
    expiresAt,
  });
  revalidatePath('/app/team/telegram');
  return { token, scope, expiresAt: expiresAt.toISOString() };
}

export async function generatePersonalLinkTokenAction(
  prev: GenerateLinkTokenState,
  formData: FormData,
): Promise<GenerateLinkTokenState> {
  return generateLinkTokenAction('personal', prev, formData);
}

export async function generateGroupLinkTokenAction(
  prev: GenerateLinkTokenState,
  formData: FormData,
): Promise<GenerateLinkTokenState> {
  return generateLinkTokenAction('group', prev, formData);
}

export async function revokeLinkTokenAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const id = formData.get('id');
  if (typeof id !== 'string') return;

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return;
  }
  await db
    .delete(telegramLinkTokens)
    .where(and(eq(telegramLinkTokens.id, id), eq(telegramLinkTokens.teamId, active.teamId)));
  revalidatePath('/app/team/telegram');
}

export async function unbindChatAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const id = formData.get('id');
  if (typeof id !== 'string') return;

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return;
  }
  await db
    .delete(telegramChatBindings)
    .where(and(eq(telegramChatBindings.id, id), eq(telegramChatBindings.teamId, active.teamId)));
  revalidatePath('/app/team/telegram');
}
