'use server';

import { isBillingAdmissionError, runWithBillingContext } from '@timeline/shared/billing';
import {
  getDigestPreference,
  previewWorkspaceUpdate,
  presentSavedViewDigest,
  scheduledUpdateWindow,
} from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';

const optionsSchema = z.object({
  cadence: z.enum(['daily', 'weekly']),
  scope: z.enum(['workspace', 'saved_views']),
  focus: z.enum(['balanced', 'progress', 'decisions', 'blockers']),
  destination: z.enum(['app', 'personal']),
});

export type UpdateFormState = {
  error?: string;
  preview?: {
    teamId: string;
    options: z.infer<typeof optionsSchema>;
    detail: string;
    links?: { id?: string; label: string; href: string }[];
  };
  saved?: boolean;
};

export async function updateSchedule(
  previous: UpdateFormState,
  form: FormData,
): Promise<UpdateFormState> {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user) return { error: 'Sign in to customize updates.' };
  if (impersonation) return { error: 'Exit impersonation to customize updates.' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active || form.get('teamId') !== active.teamId) {
    return { error: 'Your active workspace changed. Reopen Customize updates to continue.' };
  }
  const identity = { db, teamId: active.teamId, userId: session.user.id };
  const scope = withTeam(db, identity.teamId, identity.userId);
  const role = await scope.requireMembership('member');
  if (!['owner', 'admin', 'member'].includes(role))
    return { error: 'Scheduled updates are unavailable for this role.' };
  const preference = await getDigestPreference(identity);
  const intent = form.get('intent');
  const parsed = optionsSchema.safeParse(Object.fromEntries(form));

  if (intent === 'preview') {
    if (!parsed.success) return { error: 'Choose valid update preferences.' };
    const options = parsed.data;
    if (options.scope === 'saved_views') {
      const views = await scope.savedViews.preview(new Date());
      if (!views.length)
        return { error: 'Follow at least one saved view before choosing this scope.' };
      return {
        preview: {
          teamId: active.teamId,
          options,
          detail: 'This update includes new matches from the views you follow.',
          links: views.map(({ id, title, href, count }) => ({
            id,
            label:
              count === null
                ? `${title} · Preview unavailable`
                : `${title} · ${count} new ${count === 1 ? 'match' : 'matches'}`,
            href,
          })),
        },
      };
    }
    const window = scheduledUpdateWindow(
      new Date(),
      preference.timezone,
      preference.hour,
      options.cadence,
    );
    try {
      const draft = await runWithBillingContext(
        {
          ...identity,
          operationClass: 'digest',
          source: 'web',
          deliverySurface: 'web',
          billable: true,
        },
        () =>
          previewWorkspaceUpdate(
            scope,
            { windowStart: window.start, windowEnd: window.end },
            preference.timezone,
            options,
          ),
      );
      const safe = draft ? (await presentSavedViewDigest(scope, draft)).payload : null;
      return {
        preview: {
          teamId: active.teamId,
          options,
          ...(safe?.links.length ? { links: safe.links } : {}),
          detail:
            safe?.summary ??
            'There is no material briefing to preview from available sources for this window. Some sources may still be processing.',
        },
      };
    } catch (error) {
      if (!isBillingAdmissionError(error)) {
        return { error: 'The preview could not be generated. Try again in a moment.' };
      }
      return {
        error:
          'This workspace cannot run a summary right now. Previous updates are still available in Update history.',
      };
    }
  }

  if (intent !== 'pause' && intent !== 'resume' && intent !== 'save') {
    return { error: 'Choose an update action.' };
  }
  if (
    intent === 'save' &&
    (!parsed.success ||
      previous.preview?.teamId !== active.teamId ||
      Object.entries(parsed.data).some(
        ([key, value]) => previous.preview?.options[key as keyof typeof parsed.data] !== value,
      ))
  ) {
    return { error: 'Preview your current selections before saving.' };
  }
  const options = intent === 'save' && parsed.success ? parsed.data : (preference.options ?? null);
  if (
    intent === 'save' &&
    options?.scope === 'saved_views' &&
    !(await scope.savedViews.list()).some((view) => view.notify)
  ) {
    return { error: 'Follow at least one saved view before choosing this scope.' };
  }
  await scope.updatePreferences.save({
    enabled: intent !== 'pause',
    hour: preference.hour,
    timezone: preference.timezone,
    ...(intent === 'save' && options ? { options } : {}),
  });
  await safeMarkOnboardingStep(scope, 'daily_digest');
  revalidatePath('/app/updates');
  revalidatePath('/app');
  revalidatePath('/app/team');
  return { saved: true };
}
