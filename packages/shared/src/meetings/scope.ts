import { Temporal } from '@js-temporal/polyfill';
import {
  calendarEvents,
  type Db,
  meetingCaptureConfirmations,
  meetings,
  meetingTranscriptChunks,
  meetingUsage,
  rawEvents,
  savedMeetingAliases,
  savedMeetings,
  teamMeetingSettings,
} from '@timeline/db';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import {
  releaseRecallMeetingMinutes,
  settleElapsedRecallMeetingMinutes,
} from '#src/billing/admission.js';
import { createBillingScope } from '#src/billing/scope.js';
import { currentExtractionModelVersion } from '#src/extraction-model-version.js';
import { participantNames } from '#src/meetings/participants.js';
import { formatMeetingTranscript } from '#src/meetings/transcript.js';
import { decodeCursor } from '#src/pagination.js';
import { validateVisibilityUserIds } from '#src/visibility.js';

// Phase 10 — meeting scope. Mirrors the documents scope pattern: a factory
// returning per-(team,user) helpers that write every state transition
// through a single chokepoint. Each transcript chunk insert creates an
// audit raw_event row in the same transaction so existing pipelines
// (extract / embed / visibility / timeline) light up unchanged.

type Visibility = 'private' | 'team' | 'specific_users';
type MeetingPlatform = 'meet' | 'teams' | 'zoom';
type MeetingStatus =
  | 'pending'
  | 'scheduled'
  | 'joining'
  | 'active'
  | 'processing'
  | 'completed'
  | 'completed_partial'
  | 'skipped'
  | 'no_show'
  | 'cancelled'
  | 'failed';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

const TERMINAL_MEETING_STATUSES: MeetingStatus[] = [
  'completed',
  'completed_partial',
  'skipped',
  'no_show',
  'cancelled',
  'failed',
];

export interface MeetingScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: 'member' | 'admin' | 'owner') => Promise<unknown>;
  requireTeamMember?: (otherUserId: string) => Promise<void>;
}

export interface MeetingRow {
  id: string;
  teamId: string;
  createdByUserId: string | null;
  provider: string;
  providerBotId: string | null;
  savedMeetingId: string | null;
  platform: MeetingPlatform;
  meetingUrl: string;
  title: string | null;
  status: MeetingStatus;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  linkedCalendarEventId: string | null;
  defaultVisibility: Visibility;
  visibilityUserIds: string[] | null;
  participants: unknown;
  metadata: Record<string, unknown>;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMeetingInput {
  platform: MeetingPlatform;
  meetingUrl: string;
  title?: string | null;
  createdByUserId?: string | null;
  status?: MeetingStatus;
  savedMeetingId?: string | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  linkedCalendarEventId?: string | null;
  defaultVisibility?: Visibility;
  visibilityUserIds?: string[] | null;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export interface SavedMeetingScheduleConfig {
  weekdays: number[];
  times: string[];
  timezone: string;
  joinOffsetMinutes?: number;
}

export interface SavedMeetingRow {
  id: string;
  teamId: string;
  createdByUserId: string | null;
  title: string;
  description: string | null;
  platform: MeetingPlatform;
  meetingUrl: string;
  defaultVisibility: Visibility;
  visibilityUserIds: string[] | null;
  permissionConfirmedAt: Date;
  permissionConfirmedByUserId: string | null;
  scheduleConfig: SavedMeetingScheduleConfig | null;
  durationMinutes: number;
  autoJoinEnabled: boolean;
  autoJoinPausedAt: Date | null;
  autoJoinPausedReason: string | null;
  consecutiveFailureCount: number;
  archivedAt: Date | null;
  archivedByUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  aliases: string[];
}

export interface CreateSavedMeetingInput {
  title: string;
  description?: string | null;
  meetingUrl: string;
  aliases?: string[];
  defaultVisibility?: Visibility;
  visibilityUserIds?: string[] | null;
  permissionConfirmed: boolean;
  scheduleConfig?: SavedMeetingScheduleConfig | null;
  durationMinutes?: number;
  autoJoinEnabled?: boolean;
}

export class SavedMeetingAliasConflictError extends Error {
  readonly code = 'SAVED_MEETING_ALIAS_CONFLICT';

  constructor() {
    super('One or more aliases are already used by another saved meeting');
    this.name = 'SavedMeetingAliasConflictError';
  }
}

function isSavedMeetingAliasConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if (
      (current as { constraint?: unknown }).constraint === 'saved_meeting_aliases_team_norm_unq'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface MeetingCaptureConfirmationRow {
  id: string;
  teamId: string;
  requestedByUserId: string | null;
  source: 'slack' | 'telegram' | 'web';
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  platform: MeetingPlatform;
  meetingUrl: string;
  title: string | null;
  defaultVisibility: Visibility;
  visibilityUserIds: string[] | null;
  sourceContext: Record<string, unknown>;
  meetingId: string | null;
  expiresAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppendChunkInput {
  meetingId: string;
  speaker: string | null;
  text: string;
  startMs: number;
  endMs: number;
  providerChunkId: string | null;
  /** Unix ms when the utterance occurred — defaults to now if absent. */
  occurredAt?: Date;
}

export interface AppendChunkResult {
  chunkId: string;
  deduplicated: boolean;
  refreshedCalendarEventId?: string;
}

const SAVED_MEETING_MATERIALIZATION_DAYS = 28;
const SAVED_MEETING_NEARBY_BEFORE_MS = 30 * 60 * 1000;
const SAVED_MEETING_NO_SHOW_MS = 550 * 1000;
const QUICK_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export function detectMeetingPlatform(url: string): MeetingPlatform | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'meet.google.com') return 'meet';
    if (host === 'teams.microsoft.com' || host.endsWith('.teams.microsoft.com')) return 'teams';
    if (host === 'teams.live.com' || host.endsWith('.teams.live.com')) return 'teams';
    if (
      host === 'zoom.us' ||
      host.endsWith('.zoom.us') ||
      host === 'zoom.com' ||
      host.endsWith('.zoom.com')
    ) {
      return 'zoom';
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeSavedMeetingAlias(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[-_\s]+/g, ' ')
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function scheduleConfigOrNull(value: unknown): SavedMeetingScheduleConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const weekdays = Array.isArray(raw.weekdays)
    ? raw.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const times = Array.isArray(raw.times)
    ? raw.times.filter(
        (time): time is string => typeof time === 'string' && /^\d{2}:\d{2}$/.test(time),
      )
    : [];
  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone : 'UTC';
  const joinOffsetMinutes =
    typeof raw.joinOffsetMinutes === 'number' && Number.isFinite(raw.joinOffsetMinutes)
      ? Math.max(0, Math.min(30, Math.trunc(raw.joinOffsetMinutes)))
      : undefined;
  if (weekdays.length === 0 || times.length === 0) return null;
  return {
    weekdays: uniqueNumbers(weekdays),
    times: uniqueStrings(times),
    timezone,
    ...(joinOffsetMinutes !== undefined ? { joinOffsetMinutes } : {}),
  };
}

function savedMeetingRow(
  row: typeof savedMeetings.$inferSelect,
  aliases: string[] = [],
): SavedMeetingRow {
  return {
    ...(row as Omit<SavedMeetingRow, 'scheduleConfig' | 'aliases' | 'metadata'>),
    scheduleConfig: scheduleConfigOrNull(row.scheduleConfig),
    metadata: row.metadata as Record<string, unknown>,
    aliases,
  };
}

function parsePlainTime(time: string): Temporal.PlainTime | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return Temporal.PlainTime.from({ hour: hours, minute: minutes });
}

function validTimezoneOrUtc(timezone: string): string {
  try {
    Temporal.Instant.from('2026-01-01T00:00:00Z').toZonedDateTimeISO(timezone);
    return timezone;
  } catch {
    return 'UTC';
  }
}

function materializedOccurrenceStarts(
  config: SavedMeetingScheduleConfig,
  from = new Date(),
  days = SAVED_MEETING_MATERIALIZATION_DAYS,
): Date[] {
  const timezone = validTimezoneOrUtc(config.timezone);
  const fromInstant = Temporal.Instant.from(from.toISOString());
  const startDate = fromInstant.toZonedDateTimeISO(timezone).toPlainDate();
  const out: Date[] = [];
  for (let offset = 0; offset <= days; offset += 1) {
    const day = startDate.add({ days: offset });
    if (!config.weekdays.includes(day.dayOfWeek % 7)) continue;
    for (const time of config.times) {
      const plainTime = parsePlainTime(time);
      const occurrence = plainTime
        ? new Date(
            day.toPlainDateTime(plainTime).toZonedDateTime(timezone).toInstant().epochMilliseconds,
          )
        : null;
      if (occurrence && occurrence >= from) out.push(occurrence);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

function generatedCalendarTitle(title: string): string {
  return title.trim() || 'Saved meeting';
}

function meetingCalendarDescription(args: {
  meetingId: string;
  meetingUrl: string | null;
}): string {
  const parts = [`Meeting: /app/meetings/${args.meetingId}`];
  if (args.meetingUrl) parts.push(`Join URL: ${args.meetingUrl}`);
  parts.push('Summary stale: transcript changed after finalization.');
  return parts.join('\n\n');
}

function staleMeetingCalendarRawText(args: {
  title: string;
  meetingId: string;
  meetingUrl: string | null;
  participants: unknown;
  startAt: Date;
  endAt: Date;
}): string {
  const parts = [
    args.title,
    `Meeting: /app/meetings/${args.meetingId}`,
    args.meetingUrl ? `Join URL: ${args.meetingUrl}` : '',
  ];
  const names = participantNames(args.participants);
  if (names.length > 0) parts.push(`Participants: ${names.join(', ')}`);
  parts.push('Summary stale: transcript changed after finalization.');
  parts.push(`${args.startAt.toISOString()} to ${args.endAt.toISOString()}`);
  return parts.filter((part) => part.length > 0).join(' | ');
}

async function refreshFinalizedMeetingEvent(
  tx: DbOrTx,
  args: { meetingId: string; teamId: string; rawEventId: string },
): Promise<string | undefined> {
  const chunks = await tx
    .select()
    .from(meetingTranscriptChunks)
    .where(
      and(
        eq(meetingTranscriptChunks.meetingId, args.meetingId),
        eq(meetingTranscriptChunks.teamId, args.teamId),
      ),
    )
    .orderBy(asc(meetingTranscriptChunks.startMs));

  const speakers = [...new Set(chunks.map((c) => c.speaker).filter(Boolean))];
  const contentText =
    chunks.length > 0 ? formatMeetingTranscript(chunks) : 'Meeting (no transcript)';
  const metadataPatch = JSON.stringify({
    speakers,
    chunk_count: chunks.length,
    summary_stale_at: new Date().toISOString(),
  });

  await tx
    .update(rawEvents)
    .set({
      contentText,
      sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'summary' - 'action_items') || ${metadataPatch}::jsonb`,
    })
    .where(and(eq(rawEvents.id, args.rawEventId), eq(rawEvents.teamId, args.teamId)));

  await tx
    .update(meetings)
    .set({
      metadata: sql`(COALESCE(${meetings.metadata}, '{}'::jsonb) - 'summary' - 'summary_model' - 'action_items') || ${metadataPatch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(meetings.id, args.meetingId), eq(meetings.teamId, args.teamId)));

  const calendarRows = await tx
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      meetingUrl: calendarEvents.location,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      scheduledRawEventId: calendarEvents.scheduledRawEventId,
      startAtRawEventId: calendarEvents.startAtRawEventId,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, args.teamId),
        sql`(${calendarEvents.metadata} ->> 'meeting_id') = ${args.meetingId}`,
      ),
    )
    .limit(1);
  const calendar = calendarRows[0];
  if (!calendar) return undefined;

  const meetingRows = await tx
    .select({ participants: meetings.participants })
    .from(meetings)
    .where(and(eq(meetings.id, args.meetingId), eq(meetings.teamId, args.teamId)))
    .limit(1);
  const participants = meetingRows[0]?.participants ?? [];

  const description = meetingCalendarDescription({
    meetingId: args.meetingId,
    meetingUrl: calendar.meetingUrl,
  });
  await tx
    .update(calendarEvents)
    .set({
      description,
      metadata: sql`(COALESCE(${calendarEvents.metadata}, '{}'::jsonb) - 'summary' - 'action_items') || ${metadataPatch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(calendarEvents.id, calendar.id), eq(calendarEvents.teamId, args.teamId)));

  const skipPatch = JSON.stringify({
    extracted_at: new Date().toISOString(),
    extraction_skipped_at: new Date().toISOString(),
    extraction_skipped_reason: 'generated_from_meeting_bot',
    extraction_model_version: currentExtractionModelVersion(),
    summary_stale_at: new Date().toISOString(),
  });
  if (calendar.scheduledRawEventId) {
    await tx
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'summary' - 'action_items') || ${skipPatch}::jsonb`,
      })
      .where(
        and(eq(rawEvents.id, calendar.scheduledRawEventId), eq(rawEvents.teamId, args.teamId)),
      );
  }
  if (calendar.startAtRawEventId) {
    await tx
      .update(rawEvents)
      .set({
        contentText: staleMeetingCalendarRawText({
          title: calendar.title,
          meetingId: args.meetingId,
          meetingUrl: calendar.meetingUrl,
          participants,
          startAt: calendar.startAt,
          endAt: calendar.endAt,
        }),
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'summary' - 'action_items') || ${skipPatch}::jsonb`,
      })
      .where(and(eq(rawEvents.id, calendar.startAtRawEventId), eq(rawEvents.teamId, args.teamId)));
  }

  return calendar.id;
}

async function findOrCreateSavedMeetingCalendarEvent(
  db: DbOrTx,
  args: {
    teamId: string;
    saved: SavedMeetingRow;
    startAt: Date;
    endAt: Date;
  },
): Promise<string | null> {
  const existing = await db
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, args.teamId),
        isNull(calendarEvents.deletedAt),
        eq(calendarEvents.startAt, args.startAt),
        or(
          eq(calendarEvents.location, args.saved.meetingUrl),
          sql`lower(${calendarEvents.title}) = ${args.saved.title.toLowerCase()}`,
        ),
      ),
    )
    .limit(1);
  if (existing[0]?.id) return existing[0].id;

  const [row] = await db
    .insert(calendarEvents)
    .values({
      teamId: args.teamId,
      createdByUserId: args.saved.createdByUserId,
      title: generatedCalendarTitle(args.saved.title),
      description: args.saved.description,
      startAt: args.startAt,
      endAt: args.endAt,
      timezone: args.saved.scheduleConfig?.timezone ?? 'UTC',
      location: args.saved.meetingUrl,
      visibility: args.saved.defaultVisibility,
      visibilityUserIds: args.saved.visibilityUserIds,
      metadata: {
        source: 'saved_meeting',
        saved_meeting_id: args.saved.id,
        meeting_url: args.saved.meetingUrl,
        platform: args.saved.platform,
        capture_status: 'scheduled',
        generated_from_saved_meeting: true,
      },
    })
    .returning({ id: calendarEvents.id });
  return row?.id ?? null;
}

/**
 * Append a finalised transcript chunk to a meeting. Only writes to
 * `meeting_transcript_chunks` — no per-utterance `raw_events` row.
 * A single consolidated raw_event is created by the meeting-finalize
 * worker when the call ends.
 *
 * Idempotency: the unique partial index on
 * `(meeting_id, provider_chunk_id)` makes Recall retries no-ops.
 * Returns `deduplicated: true` so the webhook handler can skip
 * downstream enqueues on retry.
 */
async function appendMeetingChunkTx(
  tx: DbOrTx,
  args: {
    teamId: string;
    meetingId: string;
    speaker: string | null;
    text: string;
    startMs: number;
    endMs: number;
    providerChunkId: string | null;
  },
): Promise<AppendChunkResult | null> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${args.meetingId}, 0))`);

  const dedupKey = `meeting-finalized:${args.meetingId}`;
  const eventRows = await tx
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, args.teamId),
        sql`(${rawEvents.sourceMetadata} ->> 'meeting_chunk_provider_id') = ${dedupKey}`,
      ),
    )
    .limit(1);
  const rawEventId = eventRows[0]?.id ?? null;

  const chunkInsert = await tx
    .insert(meetingTranscriptChunks)
    .values({
      meetingId: args.meetingId,
      teamId: args.teamId,
      speaker: args.speaker,
      text: args.text,
      startMs: args.startMs,
      endMs: args.endMs,
      providerChunkId: args.providerChunkId,
      rawEventId,
    })
    .onConflictDoNothing()
    .returning({ id: meetingTranscriptChunks.id });

  let chunkId = chunkInsert[0]?.id;
  if (!chunkId) {
    if (!args.providerChunkId) return null;
    const existing = await tx
      .select({ id: meetingTranscriptChunks.id })
      .from(meetingTranscriptChunks)
      .where(
        and(
          eq(meetingTranscriptChunks.meetingId, args.meetingId),
          eq(meetingTranscriptChunks.providerChunkId, args.providerChunkId),
        ),
      )
      .limit(1);
    chunkId = existing[0]?.id;
    if (!chunkId) return null;
    if (rawEventId) {
      await tx
        .update(meetingTranscriptChunks)
        .set({ rawEventId })
        .where(
          and(
            eq(meetingTranscriptChunks.id, chunkId),
            sql`${meetingTranscriptChunks.rawEventId} IS NULL`,
          ),
        );
    }
    return { chunkId, deduplicated: true };
  }

  if (rawEventId) {
    const refreshedCalendarEventId = await refreshFinalizedMeetingEvent(tx, {
      meetingId: args.meetingId,
      teamId: args.teamId,
      rawEventId,
    });
    return refreshedCalendarEventId
      ? { chunkId, deduplicated: false, refreshedCalendarEventId }
      : { chunkId, deduplicated: false };
  }

  return { chunkId, deduplicated: false };
}

/**
 * System-mode lookup keyed on the provider's bot id. Used by the Recall
 * status + transcript webhooks, which run without a session and need to
 * resolve a meeting before they can build a `withTeam` scope. Bot ids
 * are globally-unique Recall UUIDs, so a botId match is itself the
 * authorisation signal — there's no team/user context to verify yet.
 *
 * Extracted from the scope (which requires `ensureMember`) so route
 * handlers can stay thin and mockable.
 */
export async function lookupMeetingByBotId(
  db: Db,
  botId: string,
): Promise<Pick<
  MeetingRow,
  | 'id'
  | 'teamId'
  | 'createdByUserId'
  | 'status'
  | 'platform'
  | 'provider'
  | 'defaultVisibility'
  | 'savedMeetingId'
  | 'startedAt'
  | 'endedAt'
  | 'metadata'
> | null> {
  const rows = await db
    .select({
      id: meetings.id,
      teamId: meetings.teamId,
      createdByUserId: meetings.createdByUserId,
      status: meetings.status,
      platform: meetings.platform,
      provider: meetings.provider,
      defaultVisibility: meetings.defaultVisibility,
      savedMeetingId: meetings.savedMeetingId,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
      metadata: meetings.metadata,
    })
    .from(meetings)
    .where(eq(meetings.providerBotId, botId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

export function createMeetingScope(deps: MeetingScopeDeps) {
  const { db, teamId, userId, ensureMember } = deps;

  function recallBillingScope() {
    return createBillingScope({
      db,
      teamId,
      userId,
      ensureMember: async () => {
        await ensureMember();
        return 'member';
      },
    });
  }

  async function releaseRecallReservation(meetingId: string): Promise<void> {
    await releaseRecallMeetingMinutes(recallBillingScope(), { meetingId }).catch(() => undefined);
  }

  async function settleElapsedRecallReservation(meetingId: string, endedAt: Date): Promise<void> {
    const [row] = await db
      .select({
        startedAt: meetings.startedAt,
        endedAt: meetings.endedAt,
        metadata: meetings.metadata,
      })
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);
    await settleElapsedRecallMeetingMinutes(recallBillingScope(), {
      meetingId,
      startedAt: row?.startedAt ?? null,
      endedAt: row?.endedAt ?? endedAt,
      metadata: row?.metadata,
    });
  }

  // Visibility predicate over meetings. Same shape as raw_events: team,
  // or private-only-author, or specific_users-includes-user.
  const meetingVisibility = sql`(
    ${meetings.defaultVisibility} = 'team'
    OR (${meetings.defaultVisibility} = 'private' AND ${meetings.createdByUserId} = ${userId}::uuid)
    OR (${meetings.defaultVisibility} = 'specific_users' AND ${userId}::uuid = ANY(${meetings.visibilityUserIds}))
  )`;
  const savedMeetingVisibility = sql`(
    ${savedMeetings.defaultVisibility} = 'team'
    OR (${savedMeetings.defaultVisibility} = 'private' AND ${savedMeetings.createdByUserId} = ${userId}::uuid)
    OR (${savedMeetings.defaultVisibility} = 'specific_users' AND ${userId}::uuid = ANY(${savedMeetings.visibilityUserIds}))
  )`;

  async function listSavedMeetingsInternal(
    opts: { enforceVisibility?: boolean } = {},
  ): Promise<SavedMeetingRow[]> {
    const rows = await db
      .select()
      .from(savedMeetings)
      .where(
        and(
          eq(savedMeetings.teamId, teamId),
          isNull(savedMeetings.archivedAt),
          ...(opts.enforceVisibility ? [savedMeetingVisibility] : []),
        ),
      )
      .orderBy(asc(savedMeetings.title), asc(savedMeetings.createdAt));
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const aliasRows = await db
      .select()
      .from(savedMeetingAliases)
      .where(inArray(savedMeetingAliases.savedMeetingId, ids))
      .orderBy(asc(savedMeetingAliases.alias));
    const aliasesBySavedId = new Map<string, string[]>();
    for (const alias of aliasRows) {
      const list = aliasesBySavedId.get(alias.savedMeetingId) ?? [];
      list.push(alias.alias);
      aliasesBySavedId.set(alias.savedMeetingId, list);
    }
    return rows.map((row) => savedMeetingRow(row, aliasesBySavedId.get(row.id) ?? []));
  }

  async function getSavedMeetingInternal(
    id: string,
    opts: { enforceVisibility?: boolean } = {},
  ): Promise<SavedMeetingRow | null> {
    const rows = await db
      .select()
      .from(savedMeetings)
      .where(
        and(
          eq(savedMeetings.id, id),
          eq(savedMeetings.teamId, teamId),
          ...(opts.enforceVisibility ? [savedMeetingVisibility] : []),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const aliases = await db
      .select({ alias: savedMeetingAliases.alias })
      .from(savedMeetingAliases)
      .where(eq(savedMeetingAliases.savedMeetingId, id))
      .orderBy(asc(savedMeetingAliases.alias));
    return savedMeetingRow(
      row,
      aliases.map((alias) => alias.alias),
    );
  }

  async function materializeSavedMeetingOccurrencesInternal(
    savedMeetingId: string,
  ): Promise<number> {
    const saved = await getSavedMeetingInternal(savedMeetingId);
    if (!saved?.scheduleConfig || saved.archivedAt || !saved.autoJoinEnabled) return 0;
    const starts = materializedOccurrenceStarts(saved.scheduleConfig);
    let created = 0;
    for (const startAt of starts) {
      const endAt = new Date(startAt.getTime() + saved.durationMinutes * 60 * 1000);
      const existing = await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(
          and(
            eq(meetings.teamId, teamId),
            eq(meetings.savedMeetingId, saved.id),
            eq(meetings.scheduledStartAt, startAt),
          ),
        )
        .limit(1);
      if (existing[0]) continue;

      const calendarId = await findOrCreateSavedMeetingCalendarEvent(db, {
        teamId,
        saved,
        startAt,
        endAt,
      });
      await createMeetingInternal({
        platform: saved.platform,
        meetingUrl: saved.meetingUrl,
        title: saved.title,
        createdByUserId: saved.createdByUserId,
        status: 'scheduled',
        savedMeetingId: saved.id,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        linkedCalendarEventId: calendarId,
        defaultVisibility: saved.defaultVisibility,
        visibilityUserIds: saved.visibilityUserIds,
        metadata: {
          source: 'saved_meeting',
          saved_meeting_id: saved.id,
          capture_status: 'scheduled',
        },
      });
      created += 1;
    }
    return created;
  }

  async function createMeetingInternal(input: CreateMeetingInput): Promise<MeetingRow> {
    const visibility = input.defaultVisibility ?? 'team';
    const visibilityUserIds = await validateVisibilityUserIds(
      visibility,
      input.visibilityUserIds ?? null,
      deps.requireTeamMember,
    );
    const rows = await db
      .insert(meetings)
      .values({
        teamId,
        createdByUserId: input.createdByUserId ?? userId,
        provider: input.provider ?? 'recall',
        savedMeetingId: input.savedMeetingId ?? null,
        platform: input.platform,
        meetingUrl: input.meetingUrl,
        title: input.title ?? null,
        status: input.status ?? 'pending',
        scheduledStartAt: input.scheduledStartAt ?? null,
        scheduledEndAt: input.scheduledEndAt ?? null,
        linkedCalendarEventId: input.linkedCalendarEventId ?? null,
        defaultVisibility: visibility,
        visibilityUserIds,
        metadata: input.metadata ?? {},
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create meeting');
    return row as MeetingRow;
  }

  async function recordSavedMeetingJoinFailureInternal(
    executor: DbOrTx,
    savedMeetingId: string,
    reason: 'no_show' | 'failure',
  ): Promise<{ paused: boolean; consecutiveFailureCount: number } | null> {
    const [row] = await executor
      .update(savedMeetings)
      .set({
        consecutiveFailureCount: sql`${savedMeetings.consecutiveFailureCount} + 1`,
        autoJoinPausedAt: sql`CASE WHEN ${savedMeetings.consecutiveFailureCount} + 1 >= 3 THEN now() ELSE ${savedMeetings.autoJoinPausedAt} END`,
        autoJoinPausedReason: sql`CASE WHEN ${savedMeetings.consecutiveFailureCount} + 1 >= 3 THEN ${reason} ELSE ${savedMeetings.autoJoinPausedReason} END`,
        autoJoinEnabled: sql`CASE WHEN ${savedMeetings.consecutiveFailureCount} + 1 >= 3 THEN false ELSE ${savedMeetings.autoJoinEnabled} END`,
        updatedAt: new Date(),
      })
      .where(and(eq(savedMeetings.id, savedMeetingId), eq(savedMeetings.teamId, teamId)))
      .returning({
        consecutiveFailureCount: savedMeetings.consecutiveFailureCount,
        autoJoinPausedAt: savedMeetings.autoJoinPausedAt,
      });
    if (!row) return null;
    return {
      consecutiveFailureCount: row.consecutiveFailureCount,
      paused: row.autoJoinPausedAt !== null,
    };
  }

  return {
    async createMeeting(input: CreateMeetingInput): Promise<MeetingRow> {
      await ensureMember();
      return createMeetingInternal(input);
    },

    async getMeeting(id: string): Promise<MeetingRow | null> {
      await ensureMember();
      const rows = await db
        .select()
        .from(meetings)
        .where(and(eq(meetings.id, id), eq(meetings.teamId, teamId), meetingVisibility))
        .limit(1);
      return (rows[0] as MeetingRow | undefined) ?? null;
    },

    async listMeetings(
      opts: { limit?: number; cursor?: string | null } = {},
    ): Promise<MeetingRow[]> {
      await ensureMember();
      const decoded = decodeCursor(opts.cursor);
      if (opts.cursor && !decoded) throw new Error('Invalid cursor');
      const cursorSql = decoded
        ? or(
            lt(meetings.createdAt, new Date(decoded.at)),
            and(eq(meetings.createdAt, new Date(decoded.at)), lt(meetings.id, decoded.id)),
          )
        : undefined;
      const rows = await db
        .select()
        .from(meetings)
        .where(
          and(eq(meetings.teamId, teamId), meetingVisibility, ...(cursorSql ? [cursorSql] : [])),
        )
        .orderBy(desc(meetings.createdAt), desc(meetings.id))
        .limit(opts.limit ?? 50);
      return rows as MeetingRow[];
    },

    async listSavedMeetings(): Promise<SavedMeetingRow[]> {
      await ensureMember();
      return listSavedMeetingsInternal({ enforceVisibility: true });
    },

    async getSavedMeeting(id: string): Promise<SavedMeetingRow | null> {
      await ensureMember();
      return getSavedMeetingInternal(id, { enforceVisibility: true });
    },

    async createSavedMeeting(input: CreateSavedMeetingInput): Promise<SavedMeetingRow> {
      await ensureMember();
      if (!input.permissionConfirmed) throw new Error('Saved meeting permission is required');
      const platform = detectMeetingPlatform(input.meetingUrl);
      if (!platform) throw new Error('Unsupported meeting URL');
      const title = input.title.trim();
      if (!title) throw new Error('Saved meeting title is required');
      const visibility = input.defaultVisibility ?? 'team';
      const visibilityUserIds = await validateVisibilityUserIds(
        visibility,
        input.visibilityUserIds ?? null,
        deps.requireTeamMember,
      );
      const aliases = uniqueStrings(input.aliases ?? []).map((alias) => ({
        alias,
        normalizedAlias: normalizeSavedMeetingAlias(alias),
      }));
      if (aliases.some((alias) => !alias.normalizedAlias)) {
        throw new Error('Saved meeting aliases must contain searchable text');
      }
      if (new Set(aliases.map((alias) => alias.normalizedAlias)).size !== aliases.length) {
        throw new Error('Saved meeting aliases must be unique');
      }
      const durationMinutes = Math.max(1, Math.min(24 * 60, input.durationMinutes ?? 30));
      const scheduleConfig = scheduleConfigOrNull(input.scheduleConfig);
      let row: typeof savedMeetings.$inferSelect;
      try {
        row = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(savedMeetings)
            .values({
              teamId,
              createdByUserId: userId,
              title,
              description: input.description?.trim() ?? null,
              platform,
              meetingUrl: input.meetingUrl,
              defaultVisibility: visibility,
              visibilityUserIds,
              permissionConfirmedAt: new Date(),
              permissionConfirmedByUserId: userId,
              scheduleConfig,
              durationMinutes,
              autoJoinEnabled: Boolean(input.autoJoinEnabled && scheduleConfig),
            })
            .returning();
          if (!inserted) throw new Error('Failed to create saved meeting');
          if (aliases.length > 0) {
            await tx.insert(savedMeetingAliases).values(
              aliases.map((alias) => ({
                savedMeetingId: inserted.id,
                teamId,
                alias: alias.alias,
                normalizedAlias: alias.normalizedAlias,
              })),
            );
          }
          return inserted;
        });
      } catch (error) {
        if (isSavedMeetingAliasConflict(error)) throw new SavedMeetingAliasConflictError();
        throw error;
      }
      const saved = savedMeetingRow(
        row,
        aliases.map((alias) => alias.alias),
      );
      if (saved.scheduleConfig && saved.autoJoinEnabled) {
        await materializeSavedMeetingOccurrencesInternal(saved.id);
      }
      return saved;
    },

    async updateSavedMeeting(
      id: string,
      patch: Partial<
        Pick<
          CreateSavedMeetingInput,
          | 'title'
          | 'description'
          | 'meetingUrl'
          | 'aliases'
          | 'scheduleConfig'
          | 'durationMinutes'
          | 'autoJoinEnabled'
          | 'defaultVisibility'
          | 'visibilityUserIds'
        >
      >,
    ): Promise<SavedMeetingRow | null> {
      await ensureMember();
      const existing = await getSavedMeetingInternal(id, { enforceVisibility: true });
      if (!existing || existing.archivedAt) return null;
      const meetingUrl = patch.meetingUrl?.trim() ?? existing.meetingUrl;
      const platform = detectMeetingPlatform(meetingUrl);
      if (!platform) throw new Error('Unsupported meeting URL');
      const visibility = patch.defaultVisibility ?? existing.defaultVisibility;
      const visibilityUserIds = await validateVisibilityUserIds(
        visibility,
        patch.visibilityUserIds ?? existing.visibilityUserIds,
        deps.requireTeamMember,
      );
      const scheduleConfig =
        patch.scheduleConfig !== undefined
          ? scheduleConfigOrNull(patch.scheduleConfig)
          : existing.scheduleConfig;
      const updateValues = {
        teamId,
        title: patch.title?.trim() ?? existing.title,
        description:
          patch.description !== undefined
            ? (patch.description?.trim() ?? null)
            : existing.description,
        platform,
        meetingUrl,
        defaultVisibility: visibility,
        visibilityUserIds,
        scheduleConfig,
        durationMinutes: Math.max(
          1,
          Math.min(24 * 60, patch.durationMinutes ?? existing.durationMinutes),
        ),
        autoJoinEnabled: patch.autoJoinEnabled ?? existing.autoJoinEnabled,
        updatedAt: new Date(),
      } satisfies Partial<typeof savedMeetings.$inferInsert>;
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(savedMeetings)
            .set(updateValues)
            .where(and(eq(savedMeetings.id, id), eq(savedMeetings.teamId, teamId)));
          if (patch.aliases !== undefined) {
            const aliases = uniqueStrings(patch.aliases).map((alias) => ({
              alias,
              normalizedAlias: normalizeSavedMeetingAlias(alias),
            }));
            if (new Set(aliases.map((alias) => alias.normalizedAlias)).size !== aliases.length) {
              throw new Error('Saved meeting aliases must be unique');
            }
            await tx.delete(savedMeetingAliases).where(eq(savedMeetingAliases.savedMeetingId, id));
            if (aliases.length > 0) {
              await tx.insert(savedMeetingAliases).values(
                aliases.map((alias) => ({
                  savedMeetingId: id,
                  teamId,
                  alias: alias.alias,
                  normalizedAlias: alias.normalizedAlias,
                })),
              );
            }
          }
          const futureScheduled = await tx
            .select({ id: meetings.id, linkedCalendarEventId: meetings.linkedCalendarEventId })
            .from(meetings)
            .where(
              and(
                eq(meetings.teamId, teamId),
                eq(meetings.savedMeetingId, id),
                eq(meetings.status, 'scheduled'),
                gte(meetings.scheduledStartAt, new Date()),
              ),
            );
          await tx
            .delete(meetings)
            .where(
              and(
                eq(meetings.teamId, teamId),
                eq(meetings.savedMeetingId, id),
                eq(meetings.status, 'scheduled'),
                gte(meetings.scheduledStartAt, new Date()),
              ),
            );
          const calendarIds = futureScheduled.flatMap((row) =>
            row.linkedCalendarEventId ? [row.linkedCalendarEventId] : [],
          );
          if (calendarIds.length > 0) {
            await tx
              .update(calendarEvents)
              .set({
                deletedAt: new Date(),
                updatedAt: new Date(),
                metadata: sql`COALESCE(${calendarEvents.metadata}, '{}'::jsonb) || '{"capture_status":"cancelled","cancelled_by_schedule_update":true}'::jsonb`,
              })
              .where(
                and(
                  eq(calendarEvents.teamId, teamId),
                  inArray(calendarEvents.id, calendarIds),
                  sql`COALESCE(${calendarEvents.metadata}, '{}'::jsonb) @> '{"generated_from_saved_meeting":true}'::jsonb`,
                ),
              );
          }
        });
      } catch (error) {
        if (isSavedMeetingAliasConflict(error)) throw new SavedMeetingAliasConflictError();
        throw error;
      }
      const updated = await getSavedMeetingInternal(id);
      if (updated?.scheduleConfig && updated.autoJoinEnabled) {
        await materializeSavedMeetingOccurrencesInternal(id);
      }
      return updated;
    },

    async archiveSavedMeeting(id: string): Promise<boolean> {
      await ensureMember();
      const existing = await getSavedMeetingInternal(id, { enforceVisibility: true });
      if (!existing) return false;
      const archivedAt = new Date();
      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(savedMeetings)
          .set({
            archivedAt,
            archivedByUserId: userId,
            autoJoinEnabled: false,
            updatedAt: archivedAt,
          })
          .where(and(eq(savedMeetings.id, id), eq(savedMeetings.teamId, teamId)))
          .returning({ id: savedMeetings.id });
        await tx.delete(savedMeetingAliases).where(eq(savedMeetingAliases.savedMeetingId, id));
        const futureScheduled = await tx
          .update(meetings)
          .set({
            status: 'cancelled',
            updatedAt: archivedAt,
            metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || '{"capture_status":"cancelled","cancelled_by_saved_meeting_archive":true}'::jsonb`,
          })
          .where(
            and(
              eq(meetings.teamId, teamId),
              eq(meetings.savedMeetingId, id),
              eq(meetings.status, 'scheduled'),
              gte(meetings.scheduledStartAt, archivedAt),
            ),
          )
          .returning({ linkedCalendarEventId: meetings.linkedCalendarEventId });
        const calendarIds = futureScheduled.flatMap((row) =>
          row.linkedCalendarEventId ? [row.linkedCalendarEventId] : [],
        );
        if (calendarIds.length > 0) {
          await tx
            .update(calendarEvents)
            .set({
              deletedAt: archivedAt,
              updatedAt: archivedAt,
              metadata: sql`COALESCE(${calendarEvents.metadata}, '{}'::jsonb) || '{"capture_status":"cancelled","cancelled_by_saved_meeting_archive":true}'::jsonb`,
            })
            .where(
              and(
                eq(calendarEvents.teamId, teamId),
                inArray(calendarEvents.id, calendarIds),
                sql`COALESCE(${calendarEvents.metadata}, '{}'::jsonb) @> '{"generated_from_saved_meeting":true}'::jsonb`,
              ),
            );
        }
        return rows;
      });
      return updated.length > 0;
    },

    async resolveSavedMeeting(query: string): Promise<{
      kind: 'none' | 'one' | 'many';
      savedMeeting?: SavedMeetingRow;
      matches?: SavedMeetingRow[];
    }> {
      await ensureMember();
      const normalized = normalizeSavedMeetingAlias(query);
      if (!normalized) return { kind: 'none' };
      const aliasRows = await db
        .select({ savedMeetingId: savedMeetingAliases.savedMeetingId })
        .from(savedMeetingAliases)
        .where(
          and(
            eq(savedMeetingAliases.teamId, teamId),
            eq(savedMeetingAliases.normalizedAlias, normalized),
          ),
        )
        .limit(2);
      if (aliasRows.length === 1) {
        const aliasRow = aliasRows[0];
        if (!aliasRow) return { kind: 'none' };
        const saved = await getSavedMeetingInternal(aliasRow.savedMeetingId, {
          enforceVisibility: true,
        });
        return saved && !saved.archivedAt ? { kind: 'one', savedMeeting: saved } : { kind: 'none' };
      }
      const all = await listSavedMeetingsInternal({ enforceVisibility: true });
      const exactTitle = all.filter((row) => normalizeSavedMeetingAlias(row.title) === normalized);
      const exactTitleMatch = exactTitle[0];
      if (exactTitle.length === 1 && exactTitleMatch) {
        return { kind: 'one', savedMeeting: exactTitleMatch };
      }
      if (exactTitle.length > 1) return { kind: 'many', matches: exactTitle };
      const fuzzy = all.filter((row) => {
        const title = normalizeSavedMeetingAlias(row.title);
        const aliases = row.aliases.map(normalizeSavedMeetingAlias);
        return (
          title.includes(normalized) ||
          normalized.includes(title) ||
          aliases.some((alias) => alias.includes(normalized) || normalized.includes(alias))
        );
      });
      const fuzzyMatch = fuzzy[0];
      if (fuzzy.length === 1 && fuzzyMatch) return { kind: 'one', savedMeeting: fuzzyMatch };
      if (fuzzy.length > 1) return { kind: 'many', matches: fuzzy };
      return { kind: 'none' };
    },

    async materializeSavedMeetingOccurrences(savedMeetingId: string): Promise<number> {
      await ensureMember();
      return materializeSavedMeetingOccurrencesInternal(savedMeetingId);
    },

    async findNearbyScheduledOccurrence(
      savedMeetingId: string,
      now = new Date(),
      futureWindowMs = SAVED_MEETING_NEARBY_BEFORE_MS,
    ) {
      await ensureMember();
      const from = new Date(now.getTime() - SAVED_MEETING_NO_SHOW_MS);
      const to = new Date(
        now.getTime() + Math.max(0, Math.min(SAVED_MEETING_NEARBY_BEFORE_MS, futureWindowMs)),
      );
      const rows = await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.teamId, teamId),
            eq(meetings.savedMeetingId, savedMeetingId),
            inArray(meetings.status, ['scheduled', 'pending', 'joining', 'active']),
            gte(meetings.scheduledStartAt, from),
            lte(meetings.scheduledStartAt, to),
          ),
        )
        .orderBy(asc(meetings.scheduledStartAt))
        .limit(1);
      return (rows[0] as MeetingRow | undefined) ?? null;
    },

    async findSavedMeetingForUrl(meetingUrl: string): Promise<SavedMeetingRow | null> {
      await ensureMember();
      const rows = await db
        .select({ id: savedMeetings.id })
        .from(savedMeetings)
        .where(
          and(
            eq(savedMeetings.teamId, teamId),
            eq(savedMeetings.meetingUrl, meetingUrl),
            isNull(savedMeetings.archivedAt),
            savedMeetingVisibility,
          ),
        )
        .orderBy(asc(savedMeetings.createdAt))
        .limit(1);
      const id = rows[0]?.id;
      return id ? getSavedMeetingInternal(id, { enforceVisibility: true }) : null;
    },

    async findActiveMeetingForUrl(meetingUrl: string): Promise<MeetingRow | null> {
      await ensureMember();
      const rows = await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.teamId, teamId),
            eq(meetings.meetingUrl, meetingUrl),
            inArray(meetings.status, ['joining', 'active']),
          ),
        )
        .orderBy(desc(meetings.createdAt))
        .limit(1);
      return (rows[0] as MeetingRow | undefined) ?? null;
    },

    async claimMeetingForJoin(meetingId: string): Promise<MeetingRow | null> {
      await ensureMember();
      const rows = await db
        .update(meetings)
        .set({
          status: 'joining',
          updatedAt: new Date(),
          metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || '{"manual_join_claimed":true}'::jsonb`,
        })
        .where(
          and(
            eq(meetings.id, meetingId),
            eq(meetings.teamId, teamId),
            inArray(meetings.status, ['pending', 'scheduled']),
            sql`NOT EXISTS (
              SELECT 1 FROM meetings active
              WHERE active.team_id = ${meetings.teamId}
                AND active.meeting_url = ${meetings.meetingUrl}
                AND active.status IN ('joining', 'active')
                AND active.id <> ${meetings.id}
            )`,
          ),
        )
        .returning();
      return (rows[0] as MeetingRow | undefined) ?? null;
    },

    async skipScheduledMeeting(meetingId: string): Promise<boolean> {
      await ensureMember();
      const rows = await db
        .update(meetings)
        .set({
          status: 'skipped',
          updatedAt: new Date(),
          metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || '{"capture_status":"skipped"}'::jsonb`,
        })
        .where(
          and(
            eq(meetings.id, meetingId),
            eq(meetings.teamId, teamId),
            eq(meetings.status, 'scheduled'),
          ),
        )
        .returning({ linkedCalendarEventId: meetings.linkedCalendarEventId });
      const row = rows[0];
      if (!row) return false;
      if (row.linkedCalendarEventId) {
        await db
          .update(calendarEvents)
          .set({
            metadata: sql`COALESCE(${calendarEvents.metadata}, '{}'::jsonb) || '{"capture_status":"skipped"}'::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(calendarEvents.id, row.linkedCalendarEventId),
              eq(calendarEvents.teamId, teamId),
            ),
          );
      }
      return true;
    },

    async createMeetingCaptureConfirmation(input: {
      source: 'slack' | 'telegram' | 'web';
      meetingUrl: string;
      title?: string | null;
      defaultVisibility?: Visibility;
      visibilityUserIds?: string[] | null;
      sourceContext?: Record<string, unknown>;
    }): Promise<MeetingCaptureConfirmationRow> {
      await ensureMember();
      const platform = detectMeetingPlatform(input.meetingUrl);
      if (!platform) throw new Error('Unsupported meeting URL');
      const visibility = input.defaultVisibility ?? 'team';
      const visibilityUserIds = await validateVisibilityUserIds(
        visibility,
        input.visibilityUserIds ?? null,
        deps.requireTeamMember,
      );
      const [row] = await db
        .insert(meetingCaptureConfirmations)
        .values({
          teamId,
          requestedByUserId: userId,
          source: input.source,
          platform,
          meetingUrl: input.meetingUrl,
          title: input.title?.trim() ?? null,
          defaultVisibility: visibility,
          visibilityUserIds,
          sourceContext: input.sourceContext ?? {},
          expiresAt: new Date(Date.now() + QUICK_CONFIRMATION_TTL_MS),
        })
        .returning();
      if (!row) throw new Error('Failed to create meeting capture confirmation');
      return row as MeetingCaptureConfirmationRow;
    },

    async getMeetingCaptureConfirmation(id: string): Promise<MeetingCaptureConfirmationRow | null> {
      await ensureMember();
      const rows = await db
        .select()
        .from(meetingCaptureConfirmations)
        .where(
          and(
            eq(meetingCaptureConfirmations.id, id),
            eq(meetingCaptureConfirmations.teamId, teamId),
          ),
        )
        .limit(1);
      return (rows[0] as MeetingCaptureConfirmationRow | undefined) ?? null;
    },

    async claimPendingMeetingCaptureConfirmation(
      id: string,
    ): Promise<MeetingCaptureConfirmationRow | null> {
      await ensureMember();
      const now = new Date();
      const rows = await db
        .update(meetingCaptureConfirmations)
        .set({
          status: 'confirmed',
          confirmedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(meetingCaptureConfirmations.id, id),
            eq(meetingCaptureConfirmations.teamId, teamId),
            eq(meetingCaptureConfirmations.status, 'pending'),
            gte(meetingCaptureConfirmations.expiresAt, now),
          ),
        )
        .returning();
      return (rows[0] as MeetingCaptureConfirmationRow | undefined) ?? null;
    },

    async findPendingMeetingCaptureConfirmation(input: {
      source: 'slack' | 'telegram' | 'web';
      sourceContext: Record<string, unknown>;
    }): Promise<MeetingCaptureConfirmationRow | null> {
      await ensureMember();
      const rows = await db
        .select()
        .from(meetingCaptureConfirmations)
        .where(
          and(
            eq(meetingCaptureConfirmations.teamId, teamId),
            eq(meetingCaptureConfirmations.requestedByUserId, userId),
            eq(meetingCaptureConfirmations.source, input.source),
            eq(meetingCaptureConfirmations.status, 'pending'),
            gte(meetingCaptureConfirmations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(meetingCaptureConfirmations.createdAt))
        .limit(10);
      const match = rows.find((row) => {
        const context =
          row.sourceContext &&
          typeof row.sourceContext === 'object' &&
          !Array.isArray(row.sourceContext)
            ? (row.sourceContext as Record<string, unknown>)
            : {};
        return Object.entries(input.sourceContext).every(([key, value]) => context[key] === value);
      });
      return (match as MeetingCaptureConfirmationRow | undefined) ?? null;
    },

    async markMeetingCaptureConfirmation(
      id: string,
      status: 'confirmed' | 'cancelled' | 'expired',
      meetingId?: string | null,
    ): Promise<void> {
      await ensureMember();
      const now = new Date();
      await db
        .update(meetingCaptureConfirmations)
        .set({
          status,
          ...(status === 'confirmed' ? { confirmedAt: now } : {}),
          ...(status === 'cancelled' ? { cancelledAt: now } : {}),
          ...(meetingId !== undefined ? { meetingId } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(meetingCaptureConfirmations.id, id),
            eq(meetingCaptureConfirmations.teamId, teamId),
          ),
        );
    },

    async recordSavedMeetingJoinFailure(
      savedMeetingId: string,
      reason: 'no_show' | 'failure',
    ): Promise<{ paused: boolean; consecutiveFailureCount: number } | null> {
      return recordSavedMeetingJoinFailureInternal(db, savedMeetingId, reason);
    },

    async resetSavedMeetingFailures(savedMeetingId: string): Promise<void> {
      await db
        .update(savedMeetings)
        .set({
          consecutiveFailureCount: 0,
          autoJoinPausedAt: null,
          autoJoinPausedReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(savedMeetings.id, savedMeetingId), eq(savedMeetings.teamId, teamId)));
    },

    async handleMeetingNoShow(input: {
      meetingId: string;
      providerBotId: string;
      code: string;
      endedAt: Date;
    }): Promise<'retry_scheduled' | 'terminal' | 'ignored'> {
      const now = new Date();
      const retryMetadataPatch = JSON.stringify({
        capture_status: 'scheduled',
        no_show_at: input.endedAt.toISOString(),
        no_show_code: input.code,
        no_show_retry_count: 1,
        no_show_retry_scheduled_at: now.toISOString(),
        previous_provider_bot_id: input.providerBotId,
      });
      const terminalMetadataPatch = JSON.stringify({
        capture_status: 'no_show',
        no_show_at: input.endedAt.toISOString(),
        no_show_code: input.code,
      });

      const outcome = await db.transaction(async (tx) => {
        const retryableSavedMeeting = tx
          .select({ id: savedMeetings.id })
          .from(savedMeetings)
          .where(
            and(
              eq(savedMeetings.id, meetings.savedMeetingId),
              eq(savedMeetings.teamId, teamId),
              eq(savedMeetings.autoJoinEnabled, true),
              isNull(savedMeetings.autoJoinPausedAt),
              isNull(savedMeetings.archivedAt),
            ),
          );
        const retried = await tx
          .update(meetings)
          .set({
            status: 'scheduled',
            providerBotId: null,
            startedAt: null,
            endedAt: null,
            updatedAt: now,
            metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || ${retryMetadataPatch}::jsonb`,
          })
          .where(
            and(
              eq(meetings.id, input.meetingId),
              eq(meetings.teamId, teamId),
              eq(meetings.providerBotId, input.providerBotId),
              notInArray(meetings.status, TERMINAL_MEETING_STATUSES),
              isNotNull(meetings.scheduledStartAt),
              lte(meetings.scheduledStartAt, now),
              or(isNull(meetings.scheduledEndAt), gt(meetings.scheduledEndAt, now)),
              sql`COALESCE(${meetings.metadata} ->> 'no_show_retry_count', '0') = '0'`,
              exists(retryableSavedMeeting),
            ),
          )
          .returning({ id: meetings.id });
        if (retried[0]) return 'retry_scheduled' as const;

        const terminal = await tx
          .update(meetings)
          .set({
            status: 'no_show',
            endedAt: input.endedAt,
            updatedAt: now,
            metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || ${terminalMetadataPatch}::jsonb`,
          })
          .where(
            and(
              eq(meetings.id, input.meetingId),
              eq(meetings.teamId, teamId),
              eq(meetings.providerBotId, input.providerBotId),
              notInArray(meetings.status, TERMINAL_MEETING_STATUSES),
            ),
          )
          .returning({ savedMeetingId: meetings.savedMeetingId });
        const terminalMeeting = terminal[0];
        if (!terminalMeeting) return 'ignored' as const;
        if (terminalMeeting.savedMeetingId) {
          await recordSavedMeetingJoinFailureInternal(
            tx,
            terminalMeeting.savedMeetingId,
            'no_show',
          );
        }
        return 'terminal' as const;
      });
      if (outcome === 'retry_scheduled') {
        await releaseRecallReservation(input.meetingId);
      } else if (outcome === 'terminal') {
        await settleElapsedRecallReservation(input.meetingId, input.endedAt);
      }
      return outcome;
    },

    async handleMeetingFailure(input: {
      meetingId: string;
      providerBotId: string;
      code: string;
      failedAt: Date;
    }): Promise<'failed' | 'ignored'> {
      const now = new Date();
      const metadataPatch = JSON.stringify({
        failure_at: input.failedAt.toISOString(),
        failure_code: input.code,
      });
      const outcome = await db.transaction(async (tx) => {
        const failed = await tx
          .update(meetings)
          .set({
            status: 'failed',
            endedAt: input.failedAt,
            updatedAt: now,
            metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || ${metadataPatch}::jsonb`,
          })
          .where(
            and(
              eq(meetings.id, input.meetingId),
              eq(meetings.teamId, teamId),
              eq(meetings.providerBotId, input.providerBotId),
              notInArray(meetings.status, TERMINAL_MEETING_STATUSES),
            ),
          )
          .returning({ savedMeetingId: meetings.savedMeetingId });
        const failedMeeting = failed[0];
        if (!failedMeeting) return 'ignored' as const;
        if (failedMeeting.savedMeetingId) {
          await recordSavedMeetingJoinFailureInternal(tx, failedMeeting.savedMeetingId, 'failure');
        }
        return 'failed' as const;
      });
      if (outcome === 'failed') {
        await settleElapsedRecallReservation(input.meetingId, input.failedAt);
      }
      return outcome;
    },

    async expireSavedMeetingNoShowRetries(now = new Date()): Promise<number> {
      const expiredMetadataPatch = JSON.stringify({
        capture_status: 'no_show',
        no_show_retry_expired_at: now.toISOString(),
      });
      return db.transaction(async (tx) => {
        const expired = await tx
          .update(meetings)
          .set({
            status: 'no_show',
            endedAt: now,
            updatedAt: now,
            metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || ${expiredMetadataPatch}::jsonb`,
          })
          .where(
            and(
              eq(meetings.teamId, teamId),
              eq(meetings.status, 'scheduled'),
              isNotNull(meetings.savedMeetingId),
              isNotNull(meetings.scheduledEndAt),
              lte(meetings.scheduledEndAt, now),
              sql`(${meetings.metadata} ->> 'no_show_retry_count') = '1'`,
            ),
          )
          .returning({ savedMeetingId: meetings.savedMeetingId });
        for (const row of expired) {
          if (row.savedMeetingId) {
            await recordSavedMeetingJoinFailureInternal(tx, row.savedMeetingId, 'no_show');
          }
        }
        return expired.length;
      });
    },

    async getMeetingByBotId(botId: string): Promise<MeetingRow | null> {
      await ensureMember();
      const rows = await db
        .select()
        .from(meetings)
        .where(and(eq(meetings.teamId, teamId), eq(meetings.providerBotId, botId)))
        .limit(1);
      return (rows[0] as MeetingRow | undefined) ?? null;
    },

    async listChunks(meetingId: string) {
      await ensureMember();
      const ok = await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(eq(meetings.id, meetingId), eq(meetings.teamId, teamId), meetingVisibility))
        .limit(1);
      if (!ok[0]) return [];
      return db
        .select()
        .from(meetingTranscriptChunks)
        .where(eq(meetingTranscriptChunks.meetingId, meetingId))
        .orderBy(asc(meetingTranscriptChunks.startMs));
    },

    async updateMeetingStatus(
      meetingId: string,
      status: MeetingStatus,
      patch: {
        providerBotId?: string | null;
        startedAt?: Date | null;
        endedAt?: Date | null;
        metadata?: Record<string, unknown>;
        participants?: unknown;
      } = {},
    ): Promise<void> {
      // Status updates often come from background workers / webhooks where
      // the acting user is system. We still enforce that the meeting
      // belongs to the team.
      const setClause: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (patch.providerBotId !== undefined) setClause.providerBotId = patch.providerBotId;
      if (patch.startedAt !== undefined) setClause.startedAt = patch.startedAt;
      if (patch.endedAt !== undefined) setClause.endedAt = patch.endedAt;
      if (patch.participants !== undefined) setClause.participants = patch.participants;
      if (patch.metadata) {
        // Merge into existing metadata (jsonb || jsonb).
        const patchJson = JSON.stringify(patch.metadata);
        setClause.metadata = sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || ${patchJson}::jsonb`;
      }
      await db
        .update(meetings)
        .set(setClause)
        .where(and(eq(meetings.id, meetingId), eq(meetings.teamId, teamId)));
    },

    async updateMeetingStatusForBot(
      meetingId: string,
      providerBotId: string,
      status: MeetingStatus,
      patch: {
        startedAt?: Date | null;
        endedAt?: Date | null;
        metadata?: Record<string, unknown>;
        participants?: unknown;
      } = {},
    ): Promise<boolean> {
      const setClause: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (patch.startedAt !== undefined) setClause.startedAt = patch.startedAt;
      if (patch.endedAt !== undefined) setClause.endedAt = patch.endedAt;
      if (patch.participants !== undefined) setClause.participants = patch.participants;
      if (patch.metadata) {
        const patchJson = JSON.stringify(patch.metadata);
        setClause.metadata = sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || ${patchJson}::jsonb`;
      }
      const updated = await db
        .update(meetings)
        .set(setClause)
        .where(
          and(
            eq(meetings.id, meetingId),
            eq(meetings.teamId, teamId),
            eq(meetings.providerBotId, providerBotId),
            notInArray(meetings.status, TERMINAL_MEETING_STATUSES),
          ),
        )
        .returning({ id: meetings.id });
      return updated.length > 0;
    },

    async appendMeetingChunk(input: AppendChunkInput): Promise<AppendChunkResult | null> {
      const meetingRow = await db
        .select({ id: meetings.id, teamId: meetings.teamId })
        .from(meetings)
        .where(and(eq(meetings.id, input.meetingId), eq(meetings.teamId, teamId)))
        .limit(1);
      if (!meetingRow[0]) return null;

      return db.transaction(async (tx) =>
        appendMeetingChunkTx(tx, {
          teamId,
          meetingId: input.meetingId,
          speaker: input.speaker,
          text: input.text,
          startMs: input.startMs,
          endMs: input.endMs,
          providerChunkId: input.providerChunkId,
        }),
      );
    },

    /**
     * Read team meeting settings, returning defaults if no row exists yet.
     * Lazy-create on first write via `upsertMeetingSettings`.
     */
    async getMeetingSettings() {
      await ensureMember();
      const rows = await db
        .select()
        .from(teamMeetingSettings)
        .where(eq(teamMeetingSettings.teamId, teamId))
        .limit(1);
      if (rows[0]) return rows[0];
      return {
        teamId,
        meetingMinutesCap: 600,
        meetingMinutesAdminOverride: false,
        requireHostConsent: true,
        updatedAt: new Date(),
      };
    },

    async upsertMeetingSettings(patch: {
      meetingMinutesCap?: number | null;
      meetingMinutesAdminOverride?: boolean;
      requireHostConsent?: boolean;
    }) {
      await ensureMember('admin');
      const insertValues: Record<string, unknown> = {
        teamId,
        updatedAt: new Date(),
      };
      if (patch.meetingMinutesCap !== undefined) {
        insertValues.meetingMinutesCap = patch.meetingMinutesCap;
      }
      if (patch.meetingMinutesAdminOverride !== undefined) {
        insertValues.meetingMinutesAdminOverride = patch.meetingMinutesAdminOverride;
      }
      if (patch.requireHostConsent !== undefined) {
        insertValues.requireHostConsent = patch.requireHostConsent;
      }
      const setClause: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(insertValues)) {
        if (k !== 'teamId') setClause[k] = insertValues[k];
      }
      await db
        .insert(teamMeetingSettings)
        .values(insertValues as typeof teamMeetingSettings.$inferInsert)
        .onConflictDoUpdate({ target: teamMeetingSettings.teamId, set: setClause });
    },

    /**
     * Sum of minutes recorded against this team in the current calendar
     * month. Used by `scheduleMeetingBot` for the per-team monthly cap.
     */
    async getCurrentMonthMinutes(): Promise<number> {
      await ensureMember();
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      const rows = await db
        .select({ total: sql<number>`COALESCE(SUM(${meetingUsage.minutes}), 0)::int` })
        .from(meetingUsage)
        .where(
          and(
            eq(meetingUsage.teamId, teamId),
            sql`${meetingUsage.recordedAt} >= ${start.toISOString()}`,
          ),
        );
      return rows[0]?.total ?? 0;
    },

    /**
     * Record meeting minutes used. Idempotent via unique index on
     * meeting_id — ON CONFLICT DO NOTHING.
     */
    async recordMeetingMinutes(meetingId: string, minutes: number): Promise<void> {
      await db.insert(meetingUsage).values({ teamId, meetingId, minutes }).onConflictDoNothing();
    },
  };
}

export type MeetingScope = ReturnType<typeof createMeetingScope>;
