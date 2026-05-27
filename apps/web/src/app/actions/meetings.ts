'use server';

import { childLogger, meetingBots, rateLimit, withTeam } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const log = childLogger('web:actions:meetings');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Result {
  ok: boolean;
  error?: string;
  meetingId?: string;
}

const scheduleSchema = z.object({
  meetingUrl: z.string().url().max(2000),
  title: z.string().trim().max(200).optional(),
  visibility: z.enum(['team', 'private', 'specific_users']).default('team'),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
  consentGiven: z.boolean().default(false),
});

function detectPlatform(url: string): 'meet' | 'teams' | 'zoom' | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('meet.google.com')) return 'meet';
    if (host.includes('teams.microsoft.com') || host.includes('teams.live.com')) return 'teams';
    if (host.includes('zoom.us') || host.endsWith('.zoom.us') || host.includes('zoom.com')) {
      return 'zoom';
    }
    return null;
  } catch {
    return null;
  }
}

async function withScopeOrError() {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' as const };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' as const };
  const scope = withTeam(db, active.teamId, session.user.id);
  return { scope, teamId: active.teamId, userId: session.user.id };
}

export async function scheduleMeetingBotAction(
  input: z.input<typeof scheduleSchema>,
): Promise<Result> {
  if (!meetingBots.isMeetingBotConfigured()) {
    return { ok: false, error: 'Meeting bots are not configured for this environment.' };
  }
  const transcriptWebhookUrl = meetingBots.resolveTranscriptWebhookUrl();
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const platform = detectPlatform(parsed.data.meetingUrl);
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
        'You must confirm that meeting participants will be informed the bot is recording before scheduling.',
    };
  }

  // Per-team monthly minute cap. 0 means disabled; null means unlimited.
  const cap = settings.meetingMinutesCap;
  if (cap !== null && cap === 0 && !settings.meetingMinutesAdminOverride) {
    return { ok: false, error: 'Meeting bots are disabled for this team.' };
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

  // 2. Call the provider. If it throws we mark the meeting failed and
  //    bubble the error.
  try {
    const provider = meetingBots.getMeetingBotProvider('recall');
    const join = await provider.joinMeeting({
      meetingId: meeting.id,
      teamId,
      meetingUrl: parsed.data.meetingUrl,
      platform,
      transcriptWebhookUrl,
    });
    await scope.meetings.updateMeetingStatus(meeting.id, 'joining', {
      providerBotId: join.botId,
      metadata: { provider_join_result: join.raw ?? {} },
    });
  } catch (err) {
    log.error({ err, meetingId: meeting.id }, 'recall_join_failed');
    await scope.meetings.updateMeetingStatus(meeting.id, 'failed', {
      metadata: {
        join_failed_at: new Date().toISOString(),
        join_error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
      },
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to schedule meeting bot',
    };
  }

  revalidatePath('/app/meetings');
  return { ok: true, meetingId: meeting.id };
}

export async function cancelMeetingBotAction(meetingId: string): Promise<Result> {
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
    }
  }
  await scope.meetings.updateMeetingStatus(meetingId, 'failed', {
    metadata: { cancelled_at: new Date().toISOString() },
  });
  revalidatePath('/app/meetings');
  revalidatePath(`/app/meetings/${meetingId}`);
  return { ok: true, meetingId };
}

// Note: meeting settings management (cap, consent, admin override) is
// surfaced via the team settings UI in a follow-up phase. When that lands,
// re-add a `updateMeetingSettingsAction` here that calls
// `scope.upsertMeetingSettings`. The underlying scope method is already
// tested.
