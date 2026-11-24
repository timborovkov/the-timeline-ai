'use server';

import { isBillingAdmissionError } from '@timeline/shared/billing';
import { checkRateLimit, rateLimitKey, RATE_LIMITS } from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';
import { runSentryServerAction } from '@/lib/sentry-action';
import { getSiteUrl } from '@/lib/site-url';

const id = z.uuid();

async function guestScope(teamId: string) {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user || impersonation) throw new Error('Sign in with your own account');
  return { scope: withTeam(db, id.parse(teamId), session.user.id).guests, userId: session.user.id };
}

export interface GuestInviteResult {
  url?: string;
  error?: string;
}

export async function inviteGuest(
  teamId: string,
  _previous: GuestInviteResult,
  form: FormData,
): Promise<GuestInviteResult> {
  return runSentryServerAction('guest_invite_create', async () => {
    const email = z.email().max(254).safeParse(form.get('email'));
    if (!email.success) return { error: 'Enter a valid email address.' };
    const { scope } = await guestScope(teamId);
    const result = await scope.invite(email.data);
    if (!result) return { error: 'This person already has guest access.' };
    revalidatePath('/app/team/guests');
    return { url: `${getSiteUrl()}/guest/${teamId}/invite/${result.token}` };
  });
}

export async function acceptGuest(teamId: string, token: string): Promise<void> {
  await runSentryServerAction('guest_invite_accept', async () => {
    const parsed = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(token);
    const { scope } = await guestScope(teamId);
    const accepted = await scope.accept(parsed);
    redirect(accepted ? `/guest/${teamId}` : `/guest/${teamId}/invite/${parsed}?error=unavailable`);
  });
}

export async function changeGuestGrant(teamId: string, form: FormData): Promise<void> {
  await runSentryServerAction('guest_share_change', async () => {
    const invitation = id.parse(form.get('invitation'));
    const { scope } = await guestScope(teamId);
    const operation = z
      .enum(['share', 'unshare', 'share-record', 'publish-record', 'unshare-record', 'revoke'])
      .parse(form.get('operation'));
    switch (operation) {
      case 'revoke':
        await scope.revoke(invitation);
        break;
      case 'share':
        if (!(await scope.shareSource(invitation, id.parse(form.get('source'))))) {
          redirect('/app/team/guests?error=unavailable');
        }
        break;
      case 'unshare':
        await scope.unshareSource(invitation, id.parse(form.get('source')));
        break;
      case 'share-record':
        if (!(await scope.shareRecord(invitation, id.parse(form.get('record'))))) {
          redirect('/app/team/guests?error=unavailable');
        }
        break;
      case 'publish-record': {
        const record = z
          .object({
            id,
            title: z.string().trim().min(1).max(200),
            body: z.string().trim().min(1).max(8000),
          })
          .safeParse({ id: form.get('record'), title: form.get('title'), body: form.get('body') });
        if (
          !record.success ||
          !(await scope.publishRecord(
            invitation,
            record.data.id,
            record.data.title,
            record.data.body,
          ))
        ) {
          redirect('/app/team/guests?error=unavailable');
        }
        break;
      }
      case 'unshare-record':
        await scope.unshareRecord(invitation, id.parse(form.get('record')));
        break;
    }
    revalidatePath('/app/team/guests');
  });
}

const guestSelection = z.object({ kind: z.enum(['note', 'record']), id });
export type GuestSelection = z.infer<typeof guestSelection>;

export interface GuestAnswer {
  answer?: string;
  citations?: (GuestSelection & { reference: number })[];
  error?: string;
}

export async function askGuestWork(
  teamId: string,
  selection: GuestSelection | null,
  _previous: GuestAnswer,
  form: FormData,
): Promise<GuestAnswer> {
  return runSentryServerAction('guest_ask', async () => {
    const parsed = z.string().trim().min(1).max(2000).safeParse(form.get('question'));
    if (!parsed.success) return { error: 'Enter a question of up to 2,000 characters.' };
    const { scope, userId } = await guestScope(teamId);
    const rate = await checkRateLimit({
      key: rateLimitKey('chat', 'user', userId),
      ...RATE_LIMITS.aiChat,
    });
    if (!rate.ok) return { error: 'You’ve asked too many questions. Try again in a moment.' };
    try {
      return (
        (await scope.ask(parsed.data, guestSelection.nullable().parse(selection) ?? undefined)) ?? {
          error: 'No shared work is available for this question.',
        }
      );
    } catch (error) {
      if (isBillingAdmissionError(error)) {
        return { error: 'Questions are paused for this workspace.' };
      }
      return { error: 'The answer is unavailable. Try again in a moment.' };
    }
  });
}
