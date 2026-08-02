'use server';

import { telegramChatBindings, telegramLinkTokens } from '@timeline/db';
import { randomToken } from '@timeline/shared/slug';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface GenerateLinkTokenState {
  error?: string;
  fieldError?: string;
  token?: string;
  scope?: 'personal' | 'group';
  expiresAt?: string;
}

// TG usernames: 5-32 chars, alphanumeric + underscore, no leading digit.
// We accept with or without the leading @ and normalize to lower case.
const TG_USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

function normalizeTgUsername(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^@/, '');
  if (!TG_USERNAME_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

async function generateLinkTokenAction(
  scope: 'personal' | 'group',
  _prev: GenerateLinkTokenState,
  formData: FormData,
): Promise<GenerateLinkTokenState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  const teamScope = withTeam(db, active.teamId, session.user.id);
  try {
    await teamScope.requireMembership(scope === 'group' ? 'admin' : 'member');
  } catch (err) {
    reportCaughtError(err, {
      surface: 'server_action',
      operation: `telegram_${scope}_link_token_membership`,
    });
    return { error: scope === 'group' ? 'Only admins can issue group tokens' : 'Not a member' };
  }

  const targetTgUsername = normalizeTgUsername(formData.get('tgUsername'));
  if (!targetTgUsername) {
    return {
      fieldError:
        'Enter your Telegram @username (5–32 chars, letters/numbers/underscore, must start with a letter). If you don’t have one yet, set it in Telegram: Settings → Username.',
    };
  }

  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
  await db.insert(telegramLinkTokens).values({
    token,
    teamId: active.teamId,
    scope,
    issuedByUserId: session.user.id,
    targetTgUsername,
    expiresAt,
  });
  const completedTelegram = await safeMarkOnboardingStep(teamScope, 'telegram');
  if (completedTelegram) {
    trackProductEventBestEffort(session.user.id, 'onboarding_step_completed', {
      teamId: active.teamId,
      userId: session.user.id,
      step: 'telegram',
      source: 'automatic',
    });
  }
  revalidatePath('/app/team/telegram');
  revalidatePath('/app/timeline');
  return { token, scope, expiresAt: expiresAt.toISOString() };
}

export async function generatePersonalLinkTokenAction(
  prev: GenerateLinkTokenState,
  formData: FormData,
): Promise<GenerateLinkTokenState> {
  return runSentryServerAction('generate_personal_link_token', async () => {
    return generateLinkTokenAction('personal', prev, formData);
  });
}

export async function generateGroupLinkTokenAction(
  prev: GenerateLinkTokenState,
  formData: FormData,
): Promise<GenerateLinkTokenState> {
  return runSentryServerAction('generate_group_link_token', async () => {
    return generateLinkTokenAction('group', prev, formData);
  });
}

export async function revokeLinkTokenAction(formData: FormData): Promise<void> {
  return runSentryServerAction('revoke_link_token', async () => {
    const session = await auth();
    if (!session?.user) return;
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return;
    const id = formData.get('id');
    if (typeof id !== 'string') return;

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'revoke_link_token_auth' });
      return;
    }
    await db
      .delete(telegramLinkTokens)
      .where(and(eq(telegramLinkTokens.id, id), eq(telegramLinkTokens.teamId, active.teamId)));
    revalidatePath('/app/team/telegram');
  });
}

export async function unbindChatAction(formData: FormData): Promise<void> {
  return runSentryServerAction('unbind_chat', async () => {
    const session = await auth();
    if (!session?.user) return;
    const { active } = await resolveActiveTeam(session.user.id);
    if (!active) return;
    const id = formData.get('id');
    if (typeof id !== 'string') return;

    const scope = withTeam(db, active.teamId, session.user.id);
    try {
      await scope.requireMembership('admin');
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'unbind_chat_auth' });
      return;
    }
    await db
      .delete(telegramChatBindings)
      .where(and(eq(telegramChatBindings.id, id), eq(telegramChatBindings.teamId, active.teamId)));
    revalidatePath('/app/team/telegram');
  });
}
