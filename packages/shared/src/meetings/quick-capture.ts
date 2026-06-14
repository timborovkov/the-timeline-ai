import type { Db } from '@timeline/db';

import * as meetingBots from '#src/meeting-bots/index.js';
import { detectMeetingPlatform, type MeetingRow } from '#src/meetings/scope.js';
import { withTeam } from '#src/team-scope.js';

export interface QuickJoinResult {
  ok: boolean;
  meetingId?: string;
  botName?: string;
  error?: string;
  needsConfirmation?: boolean;
  confirmationId?: string;
}

const DEFAULT_JOIN_OFFSET_MS = 2 * 60 * 1000;

function joinOffsetMs(scheduleConfig: unknown): number {
  if (!scheduleConfig || typeof scheduleConfig !== 'object') return DEFAULT_JOIN_OFFSET_MS;
  const raw = scheduleConfig as Record<string, unknown>;
  return typeof raw.joinOffsetMinutes === 'number' && Number.isFinite(raw.joinOffsetMinutes)
    ? Math.max(0, Math.min(30, Math.trunc(raw.joinOffsetMinutes))) * 60 * 1000
    : DEFAULT_JOIN_OFFSET_MS;
}

async function ensureCapacity(scope: ReturnType<typeof withTeam>): Promise<string | null> {
  const settings = await scope.meetings.getMeetingSettings();
  const cap = settings.meetingMinutesCap;
  if (cap !== null && cap === 0 && !settings.meetingMinutesAdminOverride) {
    return 'Meeting notetakers are disabled for this team.';
  }
  if (cap !== null && cap > 0 && !settings.meetingMinutesAdminOverride) {
    const used = await scope.meetings.getCurrentMonthMinutes();
    if (used >= cap) return 'Monthly meeting cap reached for this team.';
  }
  return null;
}

async function startBot(input: {
  scope: ReturnType<typeof withTeam>;
  teamId: string;
  meeting: MeetingRow;
}): Promise<QuickJoinResult> {
  const claimed = await input.scope.meetings.claimMeetingForJoin(input.meeting.id);
  if (!claimed) {
    const active = await input.scope.meetings.findActiveMeetingForUrl(input.meeting.meetingUrl);
    if (active && (active.status === 'joining' || active.status === 'active')) {
      const team = await input.scope.timeline.team();
      return {
        ok: true,
        meetingId: active.id,
        botName: meetingBots.meetingBotDisplayName(team?.name),
      };
    }
    return { ok: false, meetingId: input.meeting.id, error: 'Meeting is no longer joinable.' };
  }
  const team = await input.scope.timeline.team();
  const botName = meetingBots.meetingBotDisplayName(team?.name);
  const provider = meetingBots.getMeetingBotProvider(claimed.provider);
  try {
    const join = await provider.joinMeeting({
      meetingId: claimed.id,
      teamId: input.teamId,
      meetingUrl: claimed.meetingUrl,
      platform: claimed.platform,
      botName,
      transcriptWebhookUrl: meetingBots.resolveTranscriptWebhookUrl(),
    });
    await input.scope.meetings.updateMeetingStatus(claimed.id, 'joining', {
      providerBotId: join.botId,
      metadata: { provider_join_result: join.raw ?? {}, source: 'quick_join' },
    });
    return { ok: true, meetingId: claimed.id, botName };
  } catch (err) {
    await input.scope.meetings.updateMeetingStatus(claimed.id, 'failed', {
      metadata: {
        join_failed_at: new Date().toISOString(),
        join_error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
        source: 'quick_join',
      },
    });
    return { ok: false, meetingId: claimed.id, error: 'Failed to invite notetaker' };
  }
}

export async function joinSavedMeetingByCommand(input: {
  db: Db;
  teamId: string;
  userId: string;
  query: string;
}): Promise<QuickJoinResult> {
  if (!meetingBots.isMeetingBotConfigured()) {
    return { ok: false, error: 'Meeting notetakers are not configured.' };
  }
  const scope = withTeam(input.db, input.teamId, input.userId);
  const resolved = await scope.meetings.resolveSavedMeeting(input.query);
  if (resolved.kind === 'none' || !resolved.savedMeeting) {
    return { ok: false, error: 'Saved meeting not found.' };
  }
  if (resolved.kind === 'many') {
    return { ok: false, error: 'More than one saved meeting matched. Use a more specific alias.' };
  }
  const capacityError = await ensureCapacity(scope);
  if (capacityError) return { ok: false, error: capacityError };

  const active = await scope.meetings.findActiveMeetingForUrl(resolved.savedMeeting.meetingUrl);
  if (active && (active.status === 'joining' || active.status === 'active')) {
    const team = await scope.timeline.team();
    return {
      ok: true,
      meetingId: active.id,
      botName: meetingBots.meetingBotDisplayName(team?.name),
    };
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
        source: 'saved_meeting_command_join',
        saved_meeting_id: resolved.savedMeeting.id,
      },
    }));
  return startBot({ scope, teamId: input.teamId, meeting });
}

export async function createRawUrlQuickJoinConfirmation(input: {
  db: Db;
  teamId: string;
  userId: string;
  meetingUrl: string;
  title?: string | null;
  source: 'slack' | 'telegram' | 'web';
  sourceContext?: Record<string, unknown>;
}): Promise<QuickJoinResult> {
  const platform = detectMeetingPlatform(input.meetingUrl);
  if (!platform) return { ok: false, error: 'Unsupported meeting URL.' };
  const scope = withTeam(input.db, input.teamId, input.userId);
  const confirmation = await scope.meetings.createMeetingCaptureConfirmation({
    source: input.source,
    meetingUrl: input.meetingUrl,
    title: input.title ?? null,
    defaultVisibility: 'team',
    sourceContext: input.sourceContext ?? {},
  });
  return {
    ok: false,
    needsConfirmation: true,
    confirmationId: confirmation.id,
  };
}

export async function confirmRawUrlQuickJoin(input: {
  db: Db;
  teamId: string;
  userId: string;
  confirmationId: string;
}): Promise<QuickJoinResult> {
  if (!meetingBots.isMeetingBotConfigured()) {
    return { ok: false, error: 'Meeting notetakers are not configured.' };
  }
  const scope = withTeam(input.db, input.teamId, input.userId);
  const existing = await scope.meetings.getMeetingCaptureConfirmation(input.confirmationId);
  if (!existing) return { ok: false, error: 'Confirmation not found.' };
  if (existing.status !== 'pending') {
    return { ok: false, error: 'Confirmation is no longer pending.' };
  }
  if (existing.expiresAt < new Date()) {
    await scope.meetings.markMeetingCaptureConfirmation(existing.id, 'expired');
    return { ok: false, error: 'Confirmation expired.' };
  }

  const capacityError = await ensureCapacity(scope);
  if (capacityError) return { ok: false, error: capacityError };
  const confirmation = await scope.meetings.claimPendingMeetingCaptureConfirmation(
    input.confirmationId,
  );
  if (!confirmation) return { ok: false, error: 'Confirmation is no longer pending.' };

  const active = await scope.meetings.findActiveMeetingForUrl(confirmation.meetingUrl);
  if (active && (active.status === 'joining' || active.status === 'active')) {
    await scope.meetings.markMeetingCaptureConfirmation(confirmation.id, 'confirmed', active.id);
    const team = await scope.timeline.team();
    return {
      ok: true,
      meetingId: active.id,
      botName: meetingBots.meetingBotDisplayName(team?.name),
    };
  }

  const saved = await scope.meetings.findSavedMeetingForUrl(confirmation.meetingUrl);
  const scheduled = saved
    ? await scope.meetings.findNearbyScheduledOccurrence(
        saved.id,
        new Date(),
        joinOffsetMs(saved.scheduleConfig),
      )
    : null;
  const meeting =
    scheduled ??
    (await scope.meetings.createMeeting({
      platform: confirmation.platform,
      meetingUrl: confirmation.meetingUrl,
      title: confirmation.title,
      savedMeetingId: saved?.id ?? null,
      defaultVisibility: saved?.defaultVisibility ?? confirmation.defaultVisibility,
      visibilityUserIds: saved?.visibilityUserIds ?? confirmation.visibilityUserIds,
      metadata: {
        source: `${confirmation.source}_raw_url_confirmed`,
        confirmation_id: confirmation.id,
        ...(saved ? { saved_meeting_id: saved.id } : {}),
      },
    }));
  await scope.meetings.markMeetingCaptureConfirmation(confirmation.id, 'confirmed', meeting.id);
  const joined = await startBot({ scope, teamId: input.teamId, meeting });
  return joined;
}
