'use server';
import * as slack from '@timeline/shared/slack';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';

const bindSchema = z.object({
  conversationId: z.string().min(1),
});

const idSchema = z.object({
  id: z.uuid(),
});

export async function bindSlackConversationAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const parsed = bindSchema.safeParse({ conversationId: formData.get('conversationId') });
  if (!parsed.success) return;
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
    await slack.bindSlackConversation({
      db,
      teamId: active.teamId,
      userId: session.user.id,
      conversationId: parsed.data.conversationId,
    });
    await scope.audit.record({
      action: 'slack.settings_change',
      targetType: 'slack_conversation_binding',
      metadata: { action: 'bind', conversation_id: parsed.data.conversationId },
    });
    await safeMarkOnboardingStep(scope, 'slack');
  } catch {
    return;
  }
  revalidatePath('/app/team/slack');
  revalidatePath('/app/timeline');
}

export async function unbindSlackConversationAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return;
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
    await slack.unbindSlackConversation({
      db,
      teamId: active.teamId,
      bindingId: parsed.data.id,
    });
    await scope.audit.record({
      action: 'slack.disconnect',
      targetType: 'slack_conversation_binding',
      targetId: parsed.data.id,
      metadata: { action: 'unbind' },
    });
  } catch {
    return;
  }
  revalidatePath('/app/team/slack');
}
