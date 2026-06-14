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
  const team = await input.scope.timeline.team();
  const botName = meetingBots.meetingBotDisplayName(team?.name);
  const provider = meetingBots.getMeetingBotProvider(input.meeting.provider);
  const join = await provider.joinMeeting({
    meetingId: input.meeting.id,
    teamId: input.teamId,
    meetingUrl: input.meeting.meetingUrl,
    platform: input.meeting.platform,
    botName,
    transcriptWebhookUrl: meetingBots.resolveTranscriptWebhookUrl(),
  });
  await input.scope.meetings.updateMeetingStatus(input.meeting.id, 'joining', {
    providerBotId: join.botId,
    metadata: { provider_join_result: join.raw ?? {}, source: 'quick_join' },
  });
  return { ok: true, meetingId: input.meeting.id, botName };
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

  const scheduled = await scope.meetings.findNearbyScheduledOccurrence(resolved.savedMeeting.id);
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
  const confirmation = await scope.meetings.getMeetingCaptureConfirmation(input.confirmationId);
  if (!confirmation) return { ok: false, error: 'Confirmation not found.' };
  if (confirmation.status !== 'pending')
    return { ok: false, error: 'Confirmation is no longer pending.' };
  if (confirmation.expiresAt < new Date()) {
    await scope.meetings.markMeetingCaptureConfirmation(confirmation.id, 'expired');
    return { ok: false, error: 'Confirmation expired.' };
  }

  const capacityError = await ensureCapacity(scope);
  if (capacityError) return { ok: false, error: capacityError };
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

  const meeting = await scope.meetings.createMeeting({
    platform: confirmation.platform,
    meetingUrl: confirmation.meetingUrl,
    title: confirmation.title,
    defaultVisibility: confirmation.defaultVisibility,
    visibilityUserIds: confirmation.visibilityUserIds,
    metadata: {
      source: `${confirmation.source}_raw_url_confirmed`,
      confirmation_id: confirmation.id,
    },
  });
  const joined = await startBot({ scope, teamId: input.teamId, meeting });
  if (joined.ok) {
    await scope.meetings.markMeetingCaptureConfirmation(confirmation.id, 'confirmed', meeting.id);
  }
  return joined;
}
