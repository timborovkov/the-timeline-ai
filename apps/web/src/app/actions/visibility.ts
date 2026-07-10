'use server';
import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { publicActionError } from '@/lib/public-error';
import { runSentryServerAction } from '@/lib/sentry-action';
import { visibilitySchema } from '@/lib/visibility';

const log = childLogger('web:actions:visibility');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sourceSchema = z.enum([
  'team',
  'web',
  'telegram',
  'slack',
  'email',
  'document',
  'meeting',
  'integration',
  'calendar',
]);
export interface VisibilityActionState {
  ok?: boolean;
  error?: string;
}

async function scopeOrError() {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' as const };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' as const };
  return { scope: withTeam(db, active.teamId, session.user.id), teamId: active.teamId };
}

function idsFromForm(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === 'string' && UUID_RE.test(v));
}

function optionalUuidFromForm(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function setVisibilityDefaultAction(
  _prev: VisibilityActionState,
  formData: FormData,
): Promise<VisibilityActionState> {
  return runSentryServerAction('set_visibility_default', async () => {
    const parsed = z
      .object({
        source: sourceSchema,
        visibility: visibilitySchema,
        sourceOwnerUserId: z.string().regex(UUID_RE).nullable(),
      })
      .safeParse({
        source: formData.get('source'),
        visibility: formData.get('visibility'),
        sourceOwnerUserId: optionalUuidFromForm(formData, 'sourceOwnerUserId'),
      });
    if (!parsed.success) return { error: 'Invalid visibility default' };
    const got = await scopeOrError();
    if ('error' in got) return { error: got.error };
    try {
      await got.scope.requireMembership('admin');
      await got.scope.timeline.setVisibilityDefault({
        source: parsed.data.source,
        visibility: parsed.data.visibility,
        visibilityUserIds: idsFromForm(formData, 'visibilityUserIds'),
        sourceOwnerUserId: parsed.data.sourceOwnerUserId,
      });
      revalidatePath('/app/team');
      revalidatePath('/app/timeline');
      return { ok: true };
    } catch (err) {
      log.error({ err }, 'visibility_default_update_failed');
      return {
        error: publicActionError(err, {
          operation: 'visibility_default_update',
          fallback: 'Failed to update visibility default.',
        }),
      };
    }
  });
}

export async function setEventVisibilityAction(
  _prev: VisibilityActionState,
  formData: FormData,
): Promise<VisibilityActionState> {
  return runSentryServerAction('set_event_visibility', async () => {
    const parsed = z
      .object({ id: z.string().regex(UUID_RE), visibility: visibilitySchema })
      .safeParse({
        id: formData.get('id'),
        visibility: formData.get('visibility'),
      });
    if (!parsed.success) return { error: 'Invalid visibility' };
    const got = await scopeOrError();
    if ('error' in got) return { error: got.error };
    try {
      const updated = await got.scope.timeline.setEventVisibility(parsed.data.id, {
        visibility: parsed.data.visibility,
        visibilityUserIds: idsFromForm(formData, 'visibilityUserIds'),
      });
      if (!updated) return { error: 'Event not found or not visible' };
      revalidatePath('/app/timeline');
      return { ok: true };
    } catch (err) {
      log.error({ err }, 'event_visibility_update_failed');
      return {
        error: publicActionError(err, {
          operation: 'event_visibility_update',
          fallback: 'Failed to update event visibility.',
        }),
      };
    }
  });
}

export async function setIntegrationVisibilityDefaultAction(
  _prev: VisibilityActionState,
  formData: FormData,
): Promise<VisibilityActionState> {
  return runSentryServerAction('set_integration_visibility_default', async () => {
    const parsed = z
      .object({ id: z.string().regex(UUID_RE), visibility: visibilitySchema })
      .safeParse({ id: formData.get('id'), visibility: formData.get('visibility') });
    if (!parsed.success) return { error: 'Invalid integration visibility default' };
    const got = await scopeOrError();
    if ('error' in got) return { error: got.error };
    try {
      await got.scope.integrations.setIntegrationVisibilityDefault(
        parsed.data.id,
        parsed.data.visibility,
        idsFromForm(formData, 'visibilityUserIds'),
      );
      revalidatePath('/app/team/integrations');
      return { ok: true };
    } catch (err) {
      log.error({ err }, 'integration_visibility_default_update_failed');
      return {
        error: publicActionError(err, {
          operation: 'integration_visibility_default_update',
          fallback: 'Failed to update integration visibility default.',
        }),
      };
    }
  });
}
