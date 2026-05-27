'use server';

import { withTeam } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sourceSchema = z.enum([
  'team',
  'web',
  'telegram',
  'email',
  'document',
  'meeting',
  'integration',
  'calendar',
]);
const visibilitySchema = z.enum(['team', 'private', 'specific_users']);

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

export async function setVisibilityDefaultAction(formData: FormData): Promise<void> {
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
  if (!parsed.success) return;
  const got = await scopeOrError();
  if ('error' in got) return;
  try {
    await got.scope.timeline.setVisibilityDefault({
      source: parsed.data.source,
      visibility: parsed.data.visibility,
      visibilityUserIds: idsFromForm(formData, 'visibilityUserIds'),
      sourceOwnerUserId: parsed.data.sourceOwnerUserId,
    });
    revalidatePath('/app/team');
    revalidatePath('/app/timeline');
  } catch (err) {
    console.error('[visibility] failed to update default', err);
  }
}

export async function setEventVisibilityAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ id: z.string().regex(UUID_RE), visibility: visibilitySchema })
    .safeParse({
      id: formData.get('id'),
      visibility: formData.get('visibility'),
    });
  if (!parsed.success) return;
  const got = await scopeOrError();
  if ('error' in got) return;
  try {
    await got.scope.timeline.setEventVisibility(parsed.data.id, {
      visibility: parsed.data.visibility,
      visibilityUserIds: idsFromForm(formData, 'visibilityUserIds'),
    });
    revalidatePath('/app/timeline');
  } catch (err) {
    console.error('[visibility] failed to update event visibility', err);
  }
}

export async function setIntegrationVisibilityDefaultAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ id: z.string().regex(UUID_RE), visibility: visibilitySchema })
    .safeParse({ id: formData.get('id'), visibility: formData.get('visibility') });
  if (!parsed.success) return;
  const got = await scopeOrError();
  if ('error' in got) return;
  try {
    await got.scope.integrations.setIntegrationVisibilityDefault(
      parsed.data.id,
      parsed.data.visibility,
      idsFromForm(formData, 'visibilityUserIds'),
    );
    revalidatePath('/app/team/integrations');
  } catch (err) {
    console.error('[visibility] failed to update integration default', err);
  }
}
