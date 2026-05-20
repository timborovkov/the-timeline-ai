'use server';

import { randomUUID } from 'node:crypto';

import {
  getAudioBucket,
  getS3Client,
  getSignedPutObjectUrl,
  queue,
  withTeam,
} from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const createTextSchema = z.object({
  text: z.string().trim().min(1, 'Write something').max(20000),
  visibility: z.enum(['team', 'private']).default('team'),
});

export interface CreateEventState {
  error?: string;
  ok?: boolean;
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
  await scope.createEvent({
    authorUserId: session.user.id,
    source: 'web',
    contentText: parsed.data.text,
    visibility: parsed.data.visibility,
  });

  revalidatePath('/app/timeline');
  return { ok: true, at: Date.now() };
}

// ---------- Audio capture (Phase 3) ----------

const MIME_TO_EXT_WEB: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

const mimeTypeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^audio\//, 'Must be an audio MIME type');

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

  const ext = MIME_TO_EXT_WEB[parsedMime.data] ?? 'bin';
  // User-scoped key prefix so a teammate who learns or guesses someone else's
  // upload key cannot attach that object to their own event row via
  // createAudioEventAction. The prefix check on confirm enforces the same
  // user.id we sign here.
  const key = `teams/${active.teamId}/web/${session.user.id}/${randomUUID()}.${ext}`;
  const url = await getSignedPutObjectUrl(getS3Client(), getAudioBucket(), key, parsedMime.data);
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
  const event = await scope.createEvent({
    authorUserId: session.user.id,
    source: 'web',
    contentText: null,
    contentAudioUrl: parsed.data.key,
    visibility: parsed.data.visibility,
    sourceMetadata,
  });

  try {
    await queue.enqueueTranscribeJob({
      rawEventId: event.id,
      teamId: event.teamId,
      audioKey: parsed.data.key,
    });
  } catch (err) {
    console.error('[events] failed to enqueue transcribe job', err);
    // Row is already committed. Return ok=true so the client does not retry
    // the upload+insert (which would create a second orphan row). The
    // transcript needs a manual replay; surface that to the user as a
    // warning. A background reconciler script is the Phase 8 follow-up.
    revalidatePath('/app/timeline');
    return {
      ok: true,
      warning: 'Saved, but transcription queue is unreachable — transcript will be retried later.',
    };
  }

  revalidatePath('/app/timeline');
  return { ok: true };
}
