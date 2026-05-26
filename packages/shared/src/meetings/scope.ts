import {
  type Db,
  meetings,
  meetingTranscriptChunks,
  meetingUsage,
  teamMeetingSettings,
} from '@timeline/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

// Phase 10 — meeting scope. Mirrors the documents scope pattern: a factory
// returning per-(team,user) helpers that write every state transition
// through a single chokepoint. Each transcript chunk insert creates an
// audit raw_event row in the same transaction so existing pipelines
// (extract / embed / visibility / timeline) light up unchanged.

type Visibility = 'private' | 'team' | 'specific_users';
type MeetingPlatform = 'meet' | 'teams' | 'zoom';
type MeetingStatus = 'pending' | 'joining' | 'active' | 'processing' | 'completed' | 'failed';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export interface MeetingScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}

export interface MeetingRow {
  id: string;
  teamId: string;
  createdByUserId: string | null;
  provider: string;
  providerBotId: string | null;
  platform: MeetingPlatform;
  meetingUrl: string;
  title: string | null;
  status: MeetingStatus;
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
  defaultVisibility?: Visibility;
  visibilityUserIds?: string[] | null;
  provider?: string;
  metadata?: Record<string, unknown>;
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
    return { chunkId, deduplicated: true };
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
  'id' | 'teamId' | 'createdByUserId' | 'status' | 'platform' | 'provider'
> | null> {
  const rows = await db
    .select({
      id: meetings.id,
      teamId: meetings.teamId,
      createdByUserId: meetings.createdByUserId,
      status: meetings.status,
      platform: meetings.platform,
      provider: meetings.provider,
    })
    .from(meetings)
    .where(eq(meetings.providerBotId, botId))
    .limit(1);
  return rows[0] ?? null;
}

export function createMeetingScope(deps: MeetingScopeDeps) {
  const { db, teamId, userId, ensureMember } = deps;

  // Visibility predicate over meetings. Same shape as raw_events: team,
  // or private-only-author, or specific_users-includes-user.
  const meetingVisibility = sql`(
    ${meetings.defaultVisibility} = 'team'
    OR (${meetings.defaultVisibility} = 'private' AND ${meetings.createdByUserId} = ${userId}::uuid)
    OR (${meetings.defaultVisibility} = 'specific_users' AND ${userId}::uuid = ANY(${meetings.visibilityUserIds}))
  )`;

  return {
    async createMeeting(input: CreateMeetingInput): Promise<MeetingRow> {
      await ensureMember();
      const rows = await db
        .insert(meetings)
        .values({
          teamId,
          createdByUserId: userId,
          provider: input.provider ?? 'recall',
          platform: input.platform,
          meetingUrl: input.meetingUrl,
          title: input.title ?? null,
          status: 'pending',
          defaultVisibility: input.defaultVisibility ?? 'team',
          visibilityUserIds: input.visibilityUserIds ?? null,
          metadata: input.metadata ?? {},
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to create meeting');
      return row as MeetingRow;
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

    async listMeetings(opts: { limit?: number } = {}): Promise<MeetingRow[]> {
      await ensureMember();
      const rows = await db
        .select()
        .from(meetings)
        .where(and(eq(meetings.teamId, teamId), meetingVisibility))
        .orderBy(desc(meetings.createdAt))
        .limit(opts.limit ?? 50);
      return rows as MeetingRow[];
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
