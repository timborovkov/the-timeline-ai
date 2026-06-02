'use server';

import { randomUUID } from 'node:crypto';

import { rawEvents } from '@timeline/db';
import { cacheKey, deleteCacheKey } from '@timeline/shared/cache';
import { childLogger } from '@timeline/shared/logger';
import { getAudioBucket, getS3PresignClient, getSignedPutObjectUrl } from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';
import { requireRedisQueue } from '@/lib/queue';

const log = childLogger('web:actions');

const createTextSchema = z.object({
  text: z.string().trim().min(1, 'Write something').max(20000),
  visibility: z.enum(['team', 'private']).default('team'),
});

export interface CreateEventState {
  error?: string;
  ok?: boolean;
  warning?: string;
  // Monotonic id that changes on every successful submit so the client can
  // distinguish two consecutive successes (otherwise `ok: true` looks identical
  // to React's dep-array check and effects won't re-fire).
  at?: number;
}

export async function createTextEventAction(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  // The form sends both a hidden 'team' default and a checked 'private' when
  // the checkbox is on. Take the last value so the checkbox overrides the
  // default when present, regardless of whether `get` returns the first.
  const visibilityValues = formData.getAll('visibility');
  const visibility = visibilityValues[visibilityValues.length - 1] ?? 'team';

  const parsed = createTextSchema.safeParse({
    text: formData.get('text'),
    visibility,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const event = await scope.timeline.createEvent({
    authorUserId: session.user.id,
    visibilityOwnerUserId: session.user.id,
    source: 'web',
    contentText: parsed.data.text,
    visibility: parsed.data.visibility,
  });
  const completedFirstNote = await safeMarkOnboardingStep(scope, 'first_note');
  await deleteCacheKey(cacheKey(['onboarding', active.teamId, session.user.id]));
  trackProductEventBestEffort(session.user.id, 'capture_created', {
    teamId: active.teamId,
    userId: session.user.id,
    rawEventId: event.id,
    captureType: 'text',
    visibility: parsed.data.visibility,
  });
  if (completedFirstNote) {
    trackProductEventBestEffort(session.user.id, 'onboarding_step_completed', {
      teamId: active.teamId,
      userId: session.user.id,
      step: 'first_note',
      source: 'automatic',
    });
  }

  const processingWarnings: string[] = [];
  try {
    const queue = await requireRedisQueue();
    await queue.enqueueExtractJob({ rawEventId: event.id, teamId: event.teamId });
  } catch (err) {
    log.error({ err }, 'failed to enqueue extract job');
    // Same shape as the transcribe-enqueue failure path: mark the row so the
    // timeline UI can surface an "extraction unavailable" state. The text
    // event itself is committed and visible — only structured facts are
    // missing until the queue is reachable.
    const failurePatch = JSON.stringify({
      extraction_failed_at: new Date().toISOString(),
      extraction_error: `enqueue failed: ${err instanceof Error ? err.message.slice(0, 480) : 'unknown'}`,
    });
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, event.id))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark extract failure');
      });
    processingWarnings.push('structured extraction');
  }
  // Independently enqueue an event-level embed job (Phase 5). Same
  // independence rationale as the transcribe worker — covers events that
  // produce zero facts, and races safely with the extract worker via
  // deterministic Qdrant point ids.
  try {
    const queue = await requireRedisQueue();
    await queue.enqueueEmbedJob({ rawEventId: event.id, teamId: event.teamId });
  } catch (err) {
    log.error({ err }, 'failed to enqueue embed job');
    const failurePatch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: `enqueue failed: ${err instanceof Error ? err.message.slice(0, 480) : 'unknown'}`,
    });
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, event.id))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark embed failure');
      });
    processingWarnings.push('semantic search');
  }

  revalidatePath('/app');
  revalidatePath('/app/timeline');
  return {
    ok: true,
    at: Date.now(),
    warning:
      processingWarnings.length > 0
        ? `Saved. ${processingWarnings.join(' and ')} need attention before this is fully searchable.`
        : undefined,
  };
}

// ---------- Audio capture (Phase 3) ----------

const mimeTypeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^audio\//, 'Must be an audio MIME type');

function audioExtensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    default:
      return 'bin';
  }
}

interface RequestAudioUploadResult {
  ok: boolean;
  error?: string;
  url?: string;
  key?: string;
  contentType?: string;
}

export async function requestAudioUploadAction(
  mimeType: string,
): Promise<RequestAudioUploadResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { ok: false, error: 'No active team' };

  const parsedMime = mimeTypeSchema.safeParse(mimeType);
  if (!parsedMime.success) return { ok: false, error: 'Invalid audio type' };

  // Authoritative membership check before we hand out a signed URL.
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const ext = audioExtensionForMime(parsedMime.data);
  // User-scoped key prefix so a teammate who learns or guesses someone else's
  // upload key cannot attach that object to their own event row via
  // createAudioEventAction. The prefix check on confirm enforces the same
  // user.id we sign here.
  const key = `teams/${active.teamId}/web/${session.user.id}/${randomUUID()}.${ext}`;
  const url = await getSignedPutObjectUrl(
    getS3PresignClient(),
    getAudioBucket(),
    key,
    parsedMime.data,
  );
  return { ok: true, url, key, contentType: parsedMime.data };
}

const audioVisibilitySchema = z.enum(['team', 'private']).default('team');

const createAudioSchema = z.object({
  key: z.string().min(1).max(500),
  mimeType: mimeTypeSchema,
  durationSec: z
    .number()
    .int()
    .min(0)
    .max(60 * 60)
    .optional(),
  visibility: audioVisibilitySchema,
});

interface CreateAudioEventResult {
  ok: boolean;
  error?: string;
  /** Soft message: row committed but a follow-up step degraded (e.g. queue
   *  enqueue failed). Distinct from `error` so the client treats the audio
   *  as saved and does NOT retry the upload + insert. */
  warning?: string;
}

export async function createAudioEventAction(
  input: z.input<typeof createAudioSchema>,
): Promise<CreateAudioEventResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { ok: false, error: 'No active team' };

  const parsed = createAudioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  // Defense in depth: keys are issued by requestAudioUploadAction prefixed
  // with `teams/<active>/web/<user.id>/`. Reject anything else so a caller
  // cannot attach another user's upload (same team, different uploader) to
  // their own event row.
  const expectedPrefix = `teams/${active.teamId}/web/${session.user.id}/`;
  if (!parsed.data.key.startsWith(expectedPrefix)) {
    return { ok: false, error: 'Invalid upload key' };
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const sourceMetadata: Record<string, unknown> = {
    audio_mime_type: parsed.data.mimeType,
  };
  if (typeof parsed.data.durationSec === 'number') {
    sourceMetadata.audio_duration_sec = parsed.data.durationSec;
  }
  const event = await scope.timeline.createEvent({
    authorUserId: session.user.id,
    visibilityOwnerUserId: session.user.id,
    source: 'web',
    contentText: null,
    contentAudioUrl: parsed.data.key,
    visibility: parsed.data.visibility,
    sourceMetadata,
  });
  const completedFirstNote = await safeMarkOnboardingStep(scope, 'first_note');
  await deleteCacheKey(cacheKey(['onboarding', active.teamId, session.user.id]));
  trackProductEventBestEffort(session.user.id, 'capture_created', {
    teamId: active.teamId,
    userId: session.user.id,
    rawEventId: event.id,
    captureType: 'audio',
    visibility: parsed.data.visibility,
    durationSec: parsed.data.durationSec,
  });
  if (completedFirstNote) {
    trackProductEventBestEffort(session.user.id, 'onboarding_step_completed', {
      teamId: active.teamId,
      userId: session.user.id,
      step: 'first_note',
      source: 'automatic',
    });
  }

  try {
    const queue = await requireRedisQueue();
    await queue.enqueueTranscribeJob({
      rawEventId: event.id,
      teamId: event.teamId,
      audioKey: parsed.data.key,
    });
  } catch (err) {
    log.error({ err }, 'failed to enqueue transcribe job');
    // Row is already committed. Return ok=true so the client does not retry
    // the upload+insert (which would create a second orphan row). There is
    // NO automatic re-enqueue for the web path today — say so honestly.
    // Mark the row with the same permanent-failure shape the worker writes
    // on retry exhaustion, so the timeline UI surfaces "Transcription
    // failed" instead of "Transcribing…" indefinitely (the recorder's
    // soft warning is cleared on auto-reset and would otherwise leave the
    // user with no lasting signal). The Phase 8 reconciler is the
    // permanent fix; until then a manual replay is required.
    const failurePatch = JSON.stringify({
      transcription_failed_at: new Date().toISOString(),
      transcription_error: `enqueue failed: ${err instanceof Error ? err.message.slice(0, 480) : 'unknown'}`,
    });
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, event.id))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark row failure');
      });
    revalidatePath('/app/timeline');
    revalidatePath('/app');
    return {
      ok: true,
      warning:
        'Saved. Transcription queue is unreachable; the audio is on the timeline but the transcript needs a manual replay.',
    };
  }

  revalidatePath('/app/timeline');
  revalidatePath('/app');
  return { ok: true };
}

const removeTelegramEventSchema = z.object({
  id: z.uuid(),
});

export async function removeConversationalEventAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;

  const parsed = removeTelegramEventSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return;

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.timeline.removeConversationalMessage(parsed.data.id);
  } catch (err) {
    log.warn({ err, rawEventId: parsed.data.id }, 'remove_conversational_event_failed');
  }
  revalidatePath('/app/timeline');
}

export async function removeTelegramEventAction(formData: FormData): Promise<void> {
  await removeConversationalEventAction(formData);
}
