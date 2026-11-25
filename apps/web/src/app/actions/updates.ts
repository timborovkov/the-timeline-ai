'use server';

import { updateSettingsSchema } from '@timeline/shared/messaging/format';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';
import { reportCaughtError } from '@/lib/sentry-report';

export interface UpdateActionState {
  error?: string;
}

export async function saveUpdateAction(
  _state: UpdateActionState,
  form: FormData,
): Promise<UpdateActionState> {
  const session = await auth();
  if (!session?.user) return { error: 'Sign in to manage updates.' };
  const { active } = await resolveActiveTeam(session.user.id);
  const teamId = form.get('team');
  if (typeof teamId !== 'string' || active?.teamId !== teamId) {
    return { error: 'Your active workspace changed. Reopen Updates and try again.' };
  }
  const workspace = form.get('scope') === 'workspace';
  const key = form.get('key');
  if (typeof key !== 'string') return { error: 'Choose an update schedule.' };
  const intent = form.get('intent');
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    if ((intent === 'delete' || intent === 'reset') && !workspace) {
      await scope.updates.remove(key, intent === 'reset');
    } else if (intent === 'save') {
      const settings = updateSettingsSchema.safeParse({
        name: form.get('name'),
        enabled: form.get('enabled') === 'on',
        cadence: form.get('cadence'),
        weekday: Number(form.get('weekday')),
        time: form.get('time'),
        channel: form.get('channel'),
        detail: form.get('detail'),
        lookbackDays: Number(form.get('lookbackDays')),
        upcomingDays: Number(form.get('upcomingDays')),
        sections: form.getAll('sections'),
      });
      if (!settings.success)
        return {
          error:
            'Enter a name, a valid send time and at least one section. Use 1–14 days for each time window.',
        };
      if (workspace && active.role !== 'owner' && active.role !== 'admin')
        return { error: 'Only workspace admins can change the default.' };
      await scope.updates.save(key, settings.data, workspace);
      if (!workspace) await safeMarkOnboardingStep(scope, 'daily_digest');
    } else {
      return { error: 'Choose an update action.' };
    }
  } catch (error) {
    reportCaughtError(error, { surface: 'server_action', operation: 'update_settings' });
    return { error: 'Could not save your changes. Please try again.' };
  }
  redirect('/app/updates');
}
