'use server';

import { onboarding, withTeam } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const stepSchema = z.enum(onboarding.ONBOARDING_STEPS);
const redirectSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.startsWith('/app/'), 'Invalid redirect');

async function getOnboardingScope() {
  const session = await auth();
  if (!session?.user) return null;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return null;
  return withTeam(db, active.teamId, session.user.id).onboarding;
}

export async function dismissOnboardingChecklistAction(): Promise<void> {
  const scope = await getOnboardingScope();
  if (!scope) return;
  await scope.dismissChecklist();
  revalidatePath('/app/timeline');
}

export async function reopenOnboardingChecklistAction(): Promise<void> {
  const scope = await getOnboardingScope();
  if (!scope) redirect('/sign-in');
  await scope.reopenChecklist();
  revalidatePath('/app/timeline');
  redirect('/app/timeline');
}

export async function openOnboardingStepAction(formData: FormData): Promise<void> {
  const scope = await getOnboardingScope();
  if (!scope) redirect('/sign-in');
  const step = stepSchema.safeParse(formData.get('step'));
  const href = redirectSchema.safeParse(formData.get('href'));
  if (step.success) {
    await scope.markStepComplete(step.data);
    revalidatePath('/app/timeline');
  }
  redirect(href.success ? href.data : '/app/timeline');
}
