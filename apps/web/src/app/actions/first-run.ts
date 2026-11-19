'use server';

import { randomUUID } from 'node:crypto';

import { teamMembers, users } from '@timeline/db';
import { createOwnedWorkspace } from '@timeline/shared/agent-provisioning';
import { isFirecrawlConfigured } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import { sendMessage } from '@timeline/shared/messaging';
import {
  FIRST_RUN_PATHS,
  WEBSITE_SUBJECTS,
  type WebsiteSubject,
  TEAM_WORK_STYLES,
  parsePublicWebsiteUrl,
  type FirstRunPath,
  type FirstRunPhase,
  type GoLiveChannel,
  type TeamWorkStyle,
} from '@timeline/shared/onboarding';
import * as rateLimit from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';
import { startWebsiteScan } from '@timeline/shared/websites';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  ACTIVE_TEAM_COOKIE,
  activeTeamCookieOptions,
  resolveActiveTeam,
  serializeActiveTeamCookie,
} from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { takeAuthContinuationForUser } from '@/lib/auth-continuation';
import { db } from '@/lib/db';
import { publicActionError } from '@/lib/public-error';
import { requireRedisQueue } from '@/lib/queue';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';
import { getSiteUrl } from '@/lib/site-url';
import { applyTeamRename, teamDisplayNameSchema } from '@/lib/team-rename';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

const log = childLogger('web:actions:first-run');

const workStyleSchema = z.enum(TEAM_WORK_STYLES).nullable();
const pathSchema = z.enum(FIRST_RUN_PATHS);
const phaseSchema = z.enum([
  'welcome',
  'choose',
  'processing',
  'record',
  'ask',
  'approve',
  'live',
  'complete',
  'skipped',
  'failed',
]);

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function withFirstRunScope() {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' as const };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' as const };
  const scope = withTeam(db, active.teamId, session.user.id);
  return { scope, teamId: active.teamId, userId: session.user.id };
}

async function limitFirstRun(userId: string): Promise<string | null> {
  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('first_run', 'user', userId),
    ...rateLimit.RATE_LIMITS.firstRun,
  });
  if (!rl.ok) {
    return `Too many onboarding updates. Try again in ${String(Math.ceil(rl.retryAfterMs / 1000))} seconds.`;
  }
  return null;
}

function actor(userId: string, teamId: string) {
  return { kind: 'user' as const, userId, teamId };
}

function revalidateOnboarding(): void {
  revalidatePath('/onboarding');
  revalidatePath('/app');
  revalidatePath('/app/onboarding/record');
  revalidatePath('/app/onboarding/live');
  revalidatePath('/app/chat');
  revalidatePath('/app/approvals');
  revalidatePath('/app/team');
}

export async function submitWorkStyleAction(input: {
  workStyle: TeamWorkStyle | null;
  /**
   * Required when the signed-in user has no team yet (deferred solo create).
   * When a team already exists, renames it with the same validation as Team settings.
   */
  teamName?: string;
}): Promise<ActionResult> {
  return runSentryServerAction('submit_work_style', async () => {
    const session = await auth();
    if (!session?.user) return { ok: false, error: 'Not signed in' };
    const limited = await limitFirstRun(session.user.id);
    if (limited) return { ok: false, error: limited };
    const parsed = z
      .object({
        workStyle: workStyleSchema,
        teamName: teamDisplayNameSchema.optional(),
      })
      .safeParse(input);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'teamName')) {
        return { ok: false, error: 'Invalid team name' };
      }
      return { ok: false, error: 'Invalid work style' };
    }

    const { active } = await resolveActiveTeam(session.user.id);
    let teamId = active?.teamId ?? null;

    if (!teamId) {
      const teamName = parsed.data.teamName;
      if (teamName === undefined) {
        return { ok: false, error: 'Invalid team name' };
      }
      let createdName = teamName;
      let createdFresh = false;
      try {
        const provisioned = await db.transaction(async (tx) => {
          // Serialize concurrent Welcome submits for the same user so two tabs
          // cannot each invent an owned workspace.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${session.user.id}, 41))`,
          );
          const [existing] = await tx
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(and(eq(teamMembers.userId, session.user.id), isNull(teamMembers.removedAt)))
            .limit(1);
          if (existing) {
            return { teamId: existing.teamId, name: teamName, fresh: false as const };
          }
          const workspace = await createOwnedWorkspace(tx, {
            ownerId: session.user.id,
            name: teamName,
            timezone: DEFAULT_TIMEZONE,
          });
          return { teamId: workspace.team.id, name: workspace.team.name, fresh: true as const };
        });
        teamId = provisioned.teamId;
        createdName = provisioned.name;
        createdFresh = provisioned.fresh;
      } catch (err) {
        log.error({ err }, 'welcome_create_workspace_failed');
        reportCaughtError(err, { surface: 'server_action', operation: 'welcome_create_workspace' });
        return { ok: false, error: 'Could not create your team. Please try again.' };
      }
      const cookieStore = await cookies();
      cookieStore.set(
        ACTIVE_TEAM_COOKIE,
        serializeActiveTeamCookie(teamId),
        activeTeamCookieOptions(),
      );
      if (createdFresh) {
        trackProductEventBestEffort(actor(session.user.id, teamId), 'team_created', {
          source: 'signup',
        });
        const [owner] = await db
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, session.user.id))
          .limit(1);
        if (owner?.email) {
          await sendMessage(
            'welcome',
            {
              to: owner.email,
              name: owner.name ?? null,
              dashboardUrl: `${getSiteUrl()}/app`,
              teamName: createdName,
            },
            { db, teamId, userId: session.user.id, dedupeKey: `welcome:${session.user.id}` },
          ).catch((err: unknown) => {
            reportCaughtError(err, { surface: 'server_action', operation: 'welcome_email' });
          });
        }
      }
    } else if (parsed.data.teamName !== undefined) {
      const renamed = await applyTeamRename({
        teamId,
        userId: session.user.id,
        name: parsed.data.teamName,
      });
      if ('error' in renamed) return { ok: false, error: renamed.error };
      if (renamed.changed) {
        trackProductEventBestEffort(
          actor(session.user.id, teamId),
          'team_management_action_completed',
          {
            action: 'settings_update',
          },
        );
      }
    }

    const scope = withTeam(db, teamId, session.user.id);
    try {
      await scope.onboarding.submitWorkStyle(parsed.data.workStyle);
    } catch (err) {
      log.error({ err }, 'submitWorkStyle failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'submit_work_style',
          fallback: 'Could not save how your team works.',
        }),
      };
    }
    trackProductEventBestEffort(actor(session.user.id, teamId), 'onboarding_work_style_submitted', {
      workStyle: parsed.data.workStyle ?? 'skipped',
    });
    revalidateOnboarding();
    const authorizeResume = await takeAuthContinuationForUser(db, session.user.id);
    if (authorizeResume) redirect(authorizeResume);
    return { ok: true };
  });
}

export async function selectStarterPathAction(input: {
  path: FirstRunPath;
  websiteUrl?: string;
  websiteSubject?: WebsiteSubject;
  websitePermissionConfirmed?: boolean;
}): Promise<ActionResult> {
  return runSentryServerAction('select_starter_path', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    const limited = await limitFirstRun(got.userId);
    if (limited) return { ok: false, error: limited };
    const parsed = z
      .object({
        path: pathSchema,
        websiteUrl: z.string().max(2048).optional(),
        websiteSubject: z.enum(WEBSITE_SUBJECTS).default('own_team'),
        websitePermissionConfirmed: z.boolean().optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid starter path' };

    const scanId = randomUUID();
    let websiteUrl: string | undefined;
    let websiteHost: string | undefined;
    if (parsed.data.path === 'website') {
      if (!parsed.data.websitePermissionConfirmed)
        return { ok: false, error: 'Confirm that you may submit this website for scanning.' };
      if (!isFirecrawlConfigured())
        return {
          ok: false,
          error: 'FIRECRAWL_API_KEY is required for website scanning. Contact your administrator.',
        };
      const parsedUrl = parsePublicWebsiteUrl(parsed.data.websiteUrl ?? '');
      if ('error' in parsedUrl) return { ok: false, error: parsedUrl.error };
      websiteUrl = parsedUrl.href;
      websiteHost = parsedUrl.host;
      try {
        await requireRedisQueue();
      } catch (err) {
        log.error({ err }, 'website scan queue unavailable');
        return {
          ok: false,
          error: 'Could not start the website scan. Upload a document or forward an email instead.',
        };
      }
    }

    try {
      const selected = await got.scope.onboarding.selectStarterPath(parsed.data.path, {
        ...(websiteUrl
          ? { websiteSubject: parsed.data.websiteSubject, websiteScanId: scanId }
          : {}),
        ...(websiteUrl ? { websiteUrl } : {}),
        ...(websiteHost ? { websiteHost } : {}),
      });
      if (parsed.data.path === 'website') {
        try {
          if (!websiteUrl) throw new Error('Website URL is required.');
          if (selected.websiteScanId !== scanId)
            throw new Error('The starter selection has changed.');
          const existing = (await got.scope.websites.list()).find(
            (source) => source.url === websiteUrl,
          );
          const source =
            existing ??
            (await got.scope.websites.add({
              url: websiteUrl,
              subject: parsed.data.websiteSubject,
              permissionConfirmed: true,
            }));
          const run = await startWebsiteScan(got.scope, {
            websiteId: source.id,
            scanId,
            idempotencyKey: `onboarding:${scanId}`,
            permissionConfirmed: true,
            trigger: 'onboarding',
          });
          if (run.status === 'blocked')
            throw new Error('Website scan is blocked by billing limits');
        } catch (err) {
          log.error({ err }, 'enqueue website scan failed');
          await got.scope.onboarding.markScanFailed('unreachable', scanId);
          throw err;
        }
      }
    } catch (err) {
      log.error({ err }, 'selectStarterPath failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'select_starter_path',
          fallback: 'Could not start that capture path.',
        }),
      };
    }
    trackProductEventBestEffort(actor(got.userId, got.teamId), 'onboarding_first_path_selected', {
      path: parsed.data.path,
    });
    revalidateOnboarding();
    return { ok: true };
  });
}

export async function attachOnboardingDocumentAction(input: {
  documentId: string;
}): Promise<ActionResult> {
  return runSentryServerAction('attach_onboarding_document', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = z.object({ documentId: z.uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid document' };
    try {
      await got.scope.onboarding.selectStarterPath('document', {
        documentId: parsed.data.documentId,
      });
      await got.scope.onboarding.attachCapture({ documentId: parsed.data.documentId });
    } catch (err) {
      log.error({ err }, 'attachOnboardingDocument failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'attach_onboarding_document',
          fallback: 'Could not attach the uploaded document.',
        }),
      };
    }
    trackProductEventBestEffort(actor(got.userId, got.teamId), 'onboarding_first_path_selected', {
      path: 'document',
    });
    revalidateOnboarding();
    return { ok: true };
  });
}

export async function skipFirstRunAction(): Promise<ActionResult> {
  return runSentryServerAction('skip_first_run', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    try {
      await got.scope.onboarding.skipToEmptyHome();
    } catch (err) {
      log.error({ err }, 'skipFirstRun failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'skip_first_run',
          fallback: 'Could not skip to Home.',
        }),
      };
    }
    trackProductEventBestEffort(actor(got.userId, got.teamId), 'onboarding_first_path_selected', {
      path: 'skip',
    });
    revalidateOnboarding();
    return { ok: true };
  });
}

export async function setFirstRunPhaseAction(phase: FirstRunPhase): Promise<ActionResult> {
  return runSentryServerAction('set_first_run_phase', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = phaseSchema.safeParse(phase);
    if (!parsed.success) return { ok: false, error: 'Invalid step' };
    try {
      await got.scope.onboarding.setFirstRunPhase(parsed.data);
    } catch (err) {
      log.error({ err }, 'setFirstRunPhase failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'set_first_run_phase',
          fallback: 'Could not update onboarding.',
        }),
      };
    }
    revalidateOnboarding();
    return { ok: true };
  });
}

export async function hideGettingStartedGuideAction(): Promise<ActionResult> {
  return runSentryServerAction('hide_getting_started_guide', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    try {
      await got.scope.onboarding.hideGettingStartedGuide();
    } catch (err) {
      log.error({ err }, 'hideGettingStartedGuide failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'hide_getting_started_guide',
          fallback: 'Could not hide the guide.',
        }),
      };
    }
    revalidateOnboarding();
    return { ok: true };
  });
}

export async function completeFirstRunAction(): Promise<ActionResult> {
  return runSentryServerAction('complete_first_run', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    try {
      await got.scope.onboarding.completeFirstRun();
    } catch (err) {
      log.error({ err }, 'completeFirstRun failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'complete_first_run',
          fallback: 'Could not finish onboarding.',
        }),
      };
    }
    revalidateOnboarding();
    return { ok: true };
  });
}

export async function recordAgentDeployedAction(channel: GoLiveChannel): Promise<ActionResult> {
  return runSentryServerAction('record_agent_deployed', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = z.enum(['slack', 'telegram', 'email', 'digest', 'meeting']).safeParse(channel);
    if (!parsed.success) return { ok: false, error: 'Invalid channel' };
    trackProductEventBestEffort(actor(got.userId, got.teamId), 'agent_deployed_on_channel', {
      channel: parsed.data,
    });
    return { ok: true };
  });
}

export async function updateWorkStylePreferenceAction(input: {
  workStyle: TeamWorkStyle | null;
}): Promise<ActionResult> {
  return runSentryServerAction('update_work_style_preference', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = z.object({ workStyle: workStyleSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid work style' };
    try {
      await got.scope.requireMembership();
      await got.scope.onboarding.submitWorkStyle(parsed.data.workStyle);
    } catch (err) {
      log.error({ err }, 'updateWorkStylePreference failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'update_work_style',
          fallback: 'Could not save work style.',
        }),
      };
    }
    trackProductEventBestEffort(actor(got.userId, got.teamId), 'team_management_action_completed', {
      action: 'settings_update',
    });
    revalidatePath('/app/team');
    revalidatePath('/app/onboarding/live');
    return { ok: true };
  });
}

export async function goToOnboardingHomeAction(): Promise<void> {
  return runSentryServerAction('go_to_onboarding_home', async () => {
    const got = await withFirstRunScope();
    if ('error' in got) redirect('/sign-in');
    await got.scope.onboarding.completeFirstRun();
    revalidateOnboarding();
    redirect('/app');
  });
}
