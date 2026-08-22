'use server';
import {
  assertTeamConcurrentRecallCapacity,
  isBillingAdmissionError,
  recallBillingUserMessage,
  releaseBillingReservation,
  reserveRecallMeetingMinutes,
} from '@timeline/shared/billing';
import { childLogger } from '@timeline/shared/logger';
import * as meetingBots from '@timeline/shared/meeting-bots';
import { detectMeetingPlatform } from '@timeline/shared/meetings';
import * as rateLimit from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { publicActionError } from '@/lib/public-error';
import { requireRedisQueue } from '@/lib/queue';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';
import { visibilitySchema } from '@/lib/visibility';

const log = childLogger('web:actions:meetings');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Result {
  ok: boolean;
  error?: string;
  meetingId?: string;
}

const scheduleSchema = z.object({
  meetingUrl: z.url().max(2000),
  title: z.string().trim().max(200).optional(),
  visibility: visibilitySchema.default('team'),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
  consentGiven: z.boolean().default(false),
});

const savedMeetingScheduleSchema = z
  .object({
    weekdays: z.array(z.number().int().min(0).max(6)).default([]),
    times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).default([]),
    timezone: z.string().trim().min(1).default('UTC'),
    joinOffsetMinutes: z.number().int().min(0).max(30).default(2),
  })
  .nullable();

const createSavedMeetingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  meetingUrl: z.url().max(2000),
  aliases: z.array(z.string().trim().min(1).max(80)).default([]),
  visibility: visibilitySchema.default('team'),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
  permissionConfirmed: z.boolean().default(false),
  scheduleConfig: savedMeetingScheduleSchema.default(null),
  durationMinutes: z.number().int().min(1).max(1440).default(30),
  autoJoinEnabled: z.boolean().default(false),
});

const updateSavedMeetingSchema = createSavedMeetingSchema
  .omit({ permissionConfirmed: true })
  .extend({
    savedMeetingId: z.string().regex(UUID_RE),
  });

const joinSavedMeetingSchema = z.object({
  query: z.string().trim().min(1).max(200),
});

function joinOffsetMs(scheduleConfig: unknown): number {
  if (!scheduleConfig || typeof scheduleConfig !== 'object') return 2 * 60 * 1000;
  const raw = scheduleConfig as Record<string, unknown>;
  return typeof raw.joinOffsetMinutes === 'number' && Number.isFinite(raw.joinOffsetMinutes)
    ? Math.max(0, Math.min(30, Math.trunc(raw.joinOffsetMinutes))) * 60 * 1000
    : 2 * 60 * 1000;
}

async function withScopeOrError() {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' as const };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' as const };
  const scope = withTeam(db, active.teamId, session.user.id);
  return { scope, teamId: active.teamId, userId: session.user.id };
}

async function ensureMeetingCapacity(
  scope: ReturnType<typeof withTeam>,
  teamId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await scope.meetings.getMeetingSettings();
  const cap = settings.meetingMinutesCap;
  if (cap !== null && cap === 0 && !settings.meetingMinutesAdminOverride) {
    return { ok: false, error: 'Meeting notetakers are disabled for this team.' };
  }
  if (cap !== null && cap > 0 && !settings.meetingMinutesAdminOverride) {
    const used = await scope.meetings.getCurrentMonthMinutes();
    if (used >= cap) {
      return {
        ok: false,
        error: `Monthly meeting cap reached (${String(used)} / ${String(cap)} minutes). Ask an admin to raise the cap.`,
      };
    }
  }
  try {
    await assertTeamConcurrentRecallCapacity({ db, teamId });
  } catch (err) {
    if (isBillingAdmissionError(err)) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  return { ok: true };
}

async function startMeetingBot(input: {
  scope: ReturnType<typeof withTeam>;
  teamId: string;
  meetingId: string;
  meetingUrl: string;
  platform: 'meet' | 'teams' | 'zoom';
  provider?: string;
}): Promise<Result> {
  const claimed = await input.scope.meetings.claimMeetingForJoin(input.meetingId);
  if (!claimed) {
    const active = await input.scope.meetings.findActiveMeetingForUrl(input.meetingUrl);
    if (active && (active.status === 'joining' || active.status === 'active')) {
      return { ok: true, meetingId: active.id };
    }
    return { ok: false, meetingId: input.meetingId, error: 'Meeting is no longer joinable.' };
  }
  const admission = await reserveRecallMeetingMinutes(input.scope.billing, {
    meetingId: claimed.id,
  });
  if (!admission.ok) {
    await input.scope.meetings.updateMeetingStatus(claimed.id, 'failed', {
      metadata: {
        join_failed_at: new Date().toISOString(),
        join_error: admission.code,
      },
    });
    return {
      ok: false,
      meetingId: claimed.id,
      error: recallBillingUserMessage(admission.code),
    };
  }
  const transcriptWebhookUrl = meetingBots.resolveTranscriptWebhookUrl();
  try {
    // react-doctor-disable-next-line react-doctor/async-parallel -- Provider lookup and team load already run together; the later status update depends on the join result.
    const [provider, team] = await Promise.all([
      Promise.resolve(meetingBots.getMeetingBotProvider(claimed.provider)),
      input.scope.timeline.team(),
    ]);
    const join = await provider.joinMeeting({
      meetingId: claimed.id,
      teamId: input.teamId,
      meetingUrl: claimed.meetingUrl,
      platform: claimed.platform,
      botName: meetingBots.meetingBotDisplayName(team?.name),
      transcriptWebhookUrl,
    });
    await input.scope.meetings.updateMeetingStatus(claimed.id, 'joining', {
      providerBotId: join.botId,
      metadata: {
        provider_join_result: join.raw ?? {},
        billing_operation_id: admission.operationId,
        reserved_recall_minutes: admission.reservedMinutes,
      },
    });
    return { ok: true, meetingId: claimed.id };
  } catch (err) {
    log.error({ err, meetingId: claimed.id }, 'recall_join_failed');
    await releaseBillingReservation(input.scope.billing, admission.operationId).catch(
      () => undefined,
    );
    await input.scope.meetings.updateMeetingStatus(claimed.id, 'failed', {
      metadata: {
        join_failed_at: new Date().toISOString(),
        join_error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
      },
    });
    return {
      ok: false,
      error: publicActionError(err, {
        operation: 'recall_join_meeting',
        fallback: 'Failed to invite notetaker.',
      }),
    };
  }
}

export async function scheduleMeetingBotAction(
  input: z.input<typeof scheduleSchema>,
): Promise<Result> {
  return runSentryServerAction('schedule_meeting_bot', async () => {
    if (!meetingBots.isMeetingBotConfigured()) {
      return { ok: false, error: 'Meeting notetakers are not configured for this environment.' };
    }
    const parsed = scheduleSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }
    const platform = detectMeetingPlatform(parsed.data.meetingUrl);
    if (!platform) {
      return { ok: false, error: 'Unsupported meeting URL — use Google Meet, Teams, or Zoom.' };
    }

    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const { scope, teamId, userId } = got;
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('meeting_scheduling', 'user', userId),
      ...rateLimit.RATE_LIMITS.meetingScheduling,
    });
    if (!rl.ok) {
      return {
        ok: false,
        error: `Too many meeting scheduling attempts. Try again in ${Math.ceil(
          rl.retryAfterMs / 1000,
        )} seconds.`,
      };
    }

    // Consent gate. Defaults to required; admins can toggle the team
    // setting if they have legal cover.
    const settings = await scope.meetings.getMeetingSettings();
    if (settings.requireHostConsent && !parsed.data.consentGiven) {
      return {
        ok: false,
        error:
          'You must confirm that meeting participants will be informed the notetaker is recording before scheduling.',
      };
    }

    const capacity = await ensureMeetingCapacity(scope, teamId);
    if (!capacity.ok) return capacity;

    // 1. Create meeting row in `pending` status so we have an id to round
    //    through provider metadata.
    const meeting = await scope.meetings.createMeeting({
      platform,
      meetingUrl: parsed.data.meetingUrl,
      title: parsed.data.title ?? null,
      defaultVisibility: parsed.data.visibility,
      visibilityUserIds: parsed.data.visibilityUserIds ?? null,
      metadata: {
        silent: true,
        consent_given_at: parsed.data.consentGiven ? new Date().toISOString() : null,
      },
    });

    const started = await startMeetingBot({
      scope,
      teamId,
      meetingId: meeting.id,
      meetingUrl: parsed.data.meetingUrl,
      platform,
    });
    if (!started.ok) return started;

    trackProductEventBestEffort(userId, 'meeting_bot_scheduled', {
      teamId,
      userId,
      meetingId: meeting.id,
      platform,
      visibility: parsed.data.visibility,
    });

    revalidatePath('/app/meetings');
    return { ok: true, meetingId: meeting.id };
  });
}

export async function createSavedMeetingAction(
  input: z.input<typeof createSavedMeetingSchema>,
): Promise<Result & { savedMeetingId?: string }> {
  return runSentryServerAction('create_saved_meeting', async () => {
    const parsed = createSavedMeetingSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const { scope } = got;
    try {
      const saved = await scope.meetings.createSavedMeeting({
        title: parsed.data.title,
        description: parsed.data.description,
        meetingUrl: parsed.data.meetingUrl,
        aliases: parsed.data.aliases,
        defaultVisibility: parsed.data.visibility,
        visibilityUserIds:
          parsed.data.visibility === 'specific_users' ? parsed.data.visibilityUserIds : [],
        permissionConfirmed: parsed.data.permissionConfirmed,
        scheduleConfig: parsed.data.scheduleConfig,
        durationMinutes: parsed.data.durationMinutes,
        autoJoinEnabled: parsed.data.autoJoinEnabled,
      });
      revalidatePath('/app/meetings');
      revalidatePath('/app/calendar');
      return { ok: true, savedMeetingId: saved.id };
    } catch (err) {
      log.error({ err }, 'create_saved_meeting_failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'create_saved_meeting',
          fallback: 'Failed to save meeting.',
          expected: {
            SAVED_MEETING_ALIAS_CONFLICT: {
              message: 'One or more aliases are already used by another saved meeting.',
            },
          },
        }),
      };
    }
  });
}

export async function updateSavedMeetingAction(
  input: z.input<typeof updateSavedMeetingSchema>,
): Promise<Result & { savedMeetingId?: string }> {
  return runSentryServerAction('update_saved_meeting', async () => {
    const parsed = updateSavedMeetingSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    try {
      const saved = await got.scope.meetings.updateSavedMeeting(parsed.data.savedMeetingId, {
        title: parsed.data.title,
        description: parsed.data.description,
        meetingUrl: parsed.data.meetingUrl,
        aliases: parsed.data.aliases,
        defaultVisibility: parsed.data.visibility,
        visibilityUserIds:
          parsed.data.visibility === 'specific_users' ? parsed.data.visibilityUserIds : [],
        scheduleConfig: parsed.data.scheduleConfig,
        durationMinutes: parsed.data.durationMinutes,
        autoJoinEnabled: parsed.data.autoJoinEnabled,
      });
      if (!saved) return { ok: false, error: 'Saved meeting not found' };
      revalidatePath('/app/meetings');
      revalidatePath('/app/calendar');
      return { ok: true, savedMeetingId: saved.id };
    } catch (err) {
      log.error({ err }, 'update_saved_meeting_failed');
      return {
        ok: false,
        error: publicActionError(err, {
          operation: 'update_saved_meeting',
          fallback: 'Failed to update meeting.',
          expected: {
            SAVED_MEETING_ALIAS_CONFLICT: {
              message: 'One or more aliases are already used by another saved meeting.',
            },
          },
        }),
      };
    }
  });
}

export async function joinSavedMeetingAction(
  input: z.input<typeof joinSavedMeetingSchema>,
): Promise<Result> {
  return runSentryServerAction('join_saved_meeting', async () => {
    if (!meetingBots.isMeetingBotConfigured()) {
      return { ok: false, error: 'Meeting notetakers are not configured for this environment.' };
    }
    const parsed = joinSavedMeetingSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const { scope, teamId } = got;
    const resolved = await scope.meetings.resolveSavedMeeting(parsed.data.query);
    if (resolved.kind === 'none' || !resolved.savedMeeting) {
      return { ok: false, error: 'Saved meeting not found.' };
    }
    if (resolved.kind === 'many') {
      return {
        ok: false,
        error: 'More than one saved meeting matched. Use a more specific alias.',
      };
    }
    const capacity = await ensureMeetingCapacity(scope, teamId);
    if (!capacity.ok) return capacity;

    const active = await scope.meetings.findActiveMeetingForUrl(resolved.savedMeeting.meetingUrl);
    if (active && (active.status === 'joining' || active.status === 'active')) {
      return { ok: true, meetingId: active.id };
    }
    const scheduled = await scope.meetings.findNearbyScheduledOccurrence(
      resolved.savedMeeting.id,
      new Date(),
      joinOffsetMs(resolved.savedMeeting.scheduleConfig),
    );
    const meeting =
      scheduled ??
      (await scope.meetings.createMeeting({
        platform: resolved.savedMeeting.platform,
        meetingUrl: resolved.savedMeeting.meetingUrl,
        title: resolved.savedMeeting.title,
        savedMeetingId: resolved.savedMeeting.id,
        defaultVisibility: resolved.savedMeeting.defaultVisibility,
        visibilityUserIds: resolved.savedMeeting.visibilityUserIds,
        metadata: {
          source: 'saved_meeting_manual_join',
          saved_meeting_id: resolved.savedMeeting.id,
        },
      }));
    const started = await startMeetingBot({
      scope,
      teamId,
      meetingId: meeting.id,
      meetingUrl: meeting.meetingUrl,
      platform: meeting.platform,
    });
    if (started.ok) {
      revalidatePath('/app/meetings');
      revalidatePath(`/app/meetings/${meeting.id}`);
    }
    return started;
  });
}

export async function archiveSavedMeetingAction(savedMeetingId: string): Promise<Result> {
  return runSentryServerAction('archive_saved_meeting', async () => {
    if (!UUID_RE.test(savedMeetingId)) return { ok: false, error: 'Invalid saved meeting id' };
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const ok = await got.scope.meetings.archiveSavedMeeting(savedMeetingId);
    revalidatePath('/app/meetings');
    return ok ? { ok: true } : { ok: false, error: 'Saved meeting not found' };
  });
}

export async function skipScheduledMeetingAction(meetingId: string): Promise<Result> {
  return runSentryServerAction('skip_scheduled_meeting', async () => {
    if (!UUID_RE.test(meetingId)) return { ok: false, error: 'Invalid meeting id' };
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const ok = await got.scope.meetings.skipScheduledMeeting(meetingId);
    revalidatePath('/app/meetings');
    revalidatePath('/app/calendar');
    return ok ? { ok: true, meetingId } : { ok: false, error: 'Scheduled meeting not found' };
  });
}

export async function cancelMeetingBotAction(meetingId: string): Promise<Result> {
  return runSentryServerAction('cancel_meeting_bot', async () => {
    if (!UUID_RE.test(meetingId)) return { ok: false, error: 'Invalid meeting id' };
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const { scope } = got;

    const meeting = await scope.meetings.getMeeting(meetingId);
    if (!meeting) return { ok: false, error: 'Meeting not found' };

    // Only meetings that have not yet finished can be cancelled. `processing`
    // is excluded because the finalize worker is mid-flight — cancelling
    // there would race the worker and stamp `failed` on top of `completed`
    // a moment later. `completed` and `failed` are terminal.
    const cancellable: (typeof meeting.status)[] = ['pending', 'joining', 'active'];
    if (!cancellable.includes(meeting.status)) {
      return {
        ok: false,
        error: `Cannot cancel a meeting in status '${meeting.status}'.`,
      };
    }

    if (meeting.providerBotId) {
      try {
        const provider = meetingBots.getMeetingBotProvider(meeting.provider);
        await provider.leaveMeeting(meeting.providerBotId);
      } catch (err) {
        // Log but continue — we still want the local row marked failed so
        // the user isn't blocked on a provider-side hiccup.
        log.warn({ err, meetingId }, 'recall_leave_failed');
        reportCaughtError(err, { surface: 'server_action', operation: 'recall_leave_meeting' });
      }
    }
    const chunks = await scope.meetings.listChunks(meetingId);
    if (chunks.length > 0) {
      let queue: Awaited<ReturnType<typeof requireRedisQueue>>;
      try {
        queue = await requireRedisQueue();
      } catch (err) {
        log.warn({ err, meetingId }, 'partial_cancel_finalize_queue_unavailable');
        reportCaughtError(err, {
          surface: 'server_action',
          operation: 'partial_cancel_finalize_queue_unavailable',
        });
        return {
          ok: false,
          error: 'Cannot cancel this meeting while finalize queue is unavailable.',
        };
      }
      await scope.meetings.updateMeetingStatus(meetingId, 'processing', {
        endedAt: new Date(),
        metadata: {
          cancelled_at: new Date().toISOString(),
          partial_capture: true,
          capture_status: 'completed_partial',
        },
      });
      try {
        await queue.enqueueMeetingFinalizeJob({ meetingId, teamId: meeting.teamId });
      } catch (err) {
        log.warn({ err, meetingId }, 'partial_cancel_finalize_enqueue_failed');
        reportCaughtError(err, {
          surface: 'server_action',
          operation: 'partial_cancel_finalize_enqueue',
        });
      }
    } else {
      await scope.meetings.updateMeetingStatus(meetingId, 'cancelled', {
        metadata: { cancelled_at: new Date().toISOString(), capture_status: 'cancelled' },
      });
    }
    revalidatePath('/app/meetings');
    revalidatePath(`/app/meetings/${meetingId}`);
    return { ok: true, meetingId };
  });
}

// Note: meeting settings management (cap, consent, admin override) is
// surfaced via the team settings UI in a follow-up phase. When that lands,
// re-add a `updateMeetingSettingsAction` here that calls
// `scope.upsertMeetingSettings`. The underlying scope method is already
// tested.
