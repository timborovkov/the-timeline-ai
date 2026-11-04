'use server';

import { randomToken } from '@timeline/shared/slug';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { CONNECTIONS_HREF, CONNECTIONS_LEGACY_HREF } from '@/lib/connections';
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

function revalidateTelegramSetup(): void {
  revalidatePath(CONNECTIONS_HREF, 'layout');
  revalidatePath(CONNECTIONS_LEGACY_HREF);
  revalidatePath('/app/team/telegram');
}

async function generateLinkTokenAction(
  linkScope: 'personal' | 'group',
  _prev: GenerateLinkTokenState,
  formData: FormData,
): Promise<GenerateLinkTokenState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  const teamScope = withTeam(db, active.teamId, session.user.id);
  try {
    await teamScope.requireMembership(linkScope === 'group' ? 'admin' : 'member');
  } catch (err) {
    reportCaughtError(err, {
      surface: 'server_action',
      operation: `telegram_${linkScope}_link_token_membership`,
    });
    return { error: linkScope === 'group' ? 'Only admins can issue group tokens' : 'Not a member' };
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
  await teamScope.telegram.createLinkToken({
    scope: linkScope,
    token,
    targetTgUsername,
    expiresAt,
  });
  const completedTelegram = await safeMarkOnboardingStep(teamScope, 'telegram');
  if (completedTelegram) {
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'onboarding_step_completed',
      {
        step: 'telegram',
        source: 'automatic',
      },
    );
  }
  revalidateTelegramSetup();
  revalidatePath('/app/timeline');
  return { token, scope: linkScope, expiresAt: expiresAt.toISOString() };
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
    await scope.telegram.revokeLinkToken(id);
    revalidateTelegramSetup();
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
    await scope.telegram.unbindChat(id);
    revalidateTelegramSetup();
  });
}
