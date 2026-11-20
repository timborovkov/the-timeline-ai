import {
  SETUP_SHELL_PHASES,
  type FirstRunPhase,
  type FirstRunState,
} from '@timeline/shared/onboarding';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { CaptureUnavailable } from '@/components/onboarding/capture-unavailable';
import { SetupFlow } from '@/components/onboarding/setup-flow';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { defaultSoloTeamName } from '@/lib/default-team';
import { firstRunCaptureHref, firstRunCaptureKey } from '@/lib/first-run-links';
import { loadFirstRunStatus } from '@/lib/first-run-status';
import { resolveOnboardingConnectors } from '@/lib/onboarding-connectors';
import {
  parseOnboardingSourceIntent,
  readOnboardingSourceIntent,
} from '@/lib/onboarding-source-intent';
import { appUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ source?: string; capture?: string | string[] }>;
}

function prefillTeamName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const trimmedName = name?.trim();
  if (trimmedName && trimmedName.length > 0) return defaultSoloTeamName(trimmedName);
  const local = email?.split('@')[0]?.trim();
  if (local && local.length > 0) return defaultSoloTeamName(local);
  return defaultSoloTeamName('team');
}

function redirectForLaterPhase(phase: FirstRunPhase): never {
  if (phase === 'record') redirect('/app/onboarding/record');
  if (phase === 'ask') redirect('/app/chat');
  if (phase === 'approve') redirect('/app/approvals');
  if (phase === 'live') redirect('/app/onboarding/live');
  redirect('/app');
}

type SetupCaptureView =
  | { kind: 'unavailable' }
  | { kind: 'redirect'; href: string }
  | { kind: 'setup'; resumeHref: string | null };

function setupCaptureView(
  firstRun: FirstRunState | null,
  capture: string | string[] | undefined,
  userId: string,
): SetupCaptureView {
  const key = firstRunCaptureKey(firstRun);
  if (capture !== undefined && (capture !== key || firstRun?.startedByUserId !== userId)) {
    return { kind: 'unavailable' };
  }
  if (firstRun?.startedByUserId !== userId) return { kind: 'redirect', href: '/app' };
  if (key && firstRun.firstCaptureLandedAt && capture === key) {
    return { kind: 'redirect', href: firstRunCaptureHref(key, 'record') };
  }
  if (!SETUP_SHELL_PHASES.includes(firstRun.phase)) {
    redirectForLaterPhase(firstRun.phase);
  }
  const resumeHref = key ? firstRunCaptureHref(key) : null;
  return resumeHref && capture === undefined
    ? { kind: 'redirect', href: resumeHref }
    : { kind: 'setup', resumeHref };
}

export default async function OnboardingPage({ searchParams }: Props) {
  const [session, { capture, source }] = await Promise.all([auth(), searchParams]);
  if (!session?.user) {
    const callback =
      typeof capture === 'string' && capture.length <= 100
        ? firstRunCaptureHref(capture)
        : '/onboarding';
    redirect('/sign-in?callbackUrl=' + encodeURIComponent(callback));
  }
  const { active } = await resolveActiveTeam(session.user.id);

  // Deferred solo create: signed-in users with zero memberships name their
  // workspace here. Invite joiners already have a team and never hit this.
  if (!active) {
    if (capture !== undefined) return <CaptureUnavailable />;
    return (
      <SetupFlow
        initialStatus={{
          firstRun: null,
          inboundEmail: null,
          teamName: prefillTeamName(session.user.name, session.user.email),
          teamId: null,
          record: null,
        }}
      />
    );
  }

  const cookieIntent = await readOnboardingSourceIntent();
  // Cookie clear happens in selectStarterPathAction (Server Action) — RSC cannot mutate cookies.
  const preferredSource = parseOnboardingSourceIntent(source) ?? cookieIntent;

  const status = await loadFirstRunStatus({
    db,
    teamId: active.teamId,
    userId: session.user.id,
    teamSlug: active.teamSlug,
    teamName: active.teamName,
  });
  const view = setupCaptureView(status.firstRun, capture, session.user.id);
  if (view.kind === 'unavailable') return <CaptureUnavailable />;
  if (view.kind === 'redirect') redirect(view.href);
  const { resumeHref } = view;
  const { connectors, telegramBotUsername } = resolveOnboardingConnectors();
  const calendar = await withTeam(
    db,
    active.teamId,
    session.user.id,
  ).calendar.getCalendarSettings();
  return (
    <WorkspaceTimezoneProvider timezone={calendar.defaultTimezone}>
      <SetupFlow
        initialStatus={status}
        captureUrl={resumeHref ? appUrl(resumeHref).href : null}
        preferredSource={preferredSource}
        connectors={connectors}
        telegramBotUsername={telegramBotUsername}
      />
    </WorkspaceTimezoneProvider>
  );
}
