import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const activateSchema = z.object({
  providerConnectionId: z.uuid(),
  resourceShareIds: z.array(z.uuid()),
});

async function markFirstIntegrationAfterActivation(
  scope: ReturnType<typeof withTeam>,
  integrationId: string,
) {
  if (!integrationId) return false;
  return safeMarkOnboardingStep(scope, 'first_integration');
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = activateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const integration = await scope.integrations.activateSharedResources(parsed.data);
  const completedFirstIntegration = await markFirstIntegrationAfterActivation(
    scope,
    integration.id,
  );
  trackProductEventBestEffort(session.user.id, 'integration_connected', {
    teamId: active.teamId,
    userId: session.user.id,
    integrationId: integration.id,
    provider: integration.provider,
  });
  if (completedFirstIntegration) {
    trackProductEventBestEffort(session.user.id, 'onboarding_step_completed', {
      teamId: active.teamId,
      userId: session.user.id,
      step: 'first_integration',
      source: 'automatic',
    });
  }
  return NextResponse.json({ ok: true, integrationId: integration.id });
}
