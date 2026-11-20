import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { loadFirstRunStatus } from '@/lib/first-run-status';
import { reportCaughtError } from '@/lib/sentry-report';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers });
  }
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) {
    return NextResponse.json({ error: 'No active team' }, { status: 403, headers });
  }

  try {
    const status = await loadFirstRunStatus({
      db,
      teamId: active.teamId,
      userId: session.user.id,
      teamSlug: active.teamSlug,
      teamName: active.teamName,
    });
    return NextResponse.json(status, { headers });
  } catch (err) {
    reportCaughtError(err, { surface: 'api', operation: 'onboarding_first_run_status' });
    return NextResponse.json(
      { error: 'Unable to load onboarding status' },
      { status: 500, headers },
    );
  }
}
