import {
  documentVersions,
  facts as factsTable,
  integrations,
  meetings,
  rawEvents,
} from '@timeline/db';
import { cacheKey, cachedJson } from '@timeline/shared/cache';
import { withTeam } from '@timeline/shared/team-scope';
import { and, count, eq, isNotNull, lt, notExists, sql } from 'drizzle-orm';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const retrySchema = z.object({
  kind: z.enum(['transcription', 'extraction', 'embedding', 'document_processing']),
  id: z.string().regex(UUID_RE),
});

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const staleCutoff = new Date(Date.now() - 15 * 60 * 1000);
  const key = cacheKey(['job-dashboard', active.teamId, session.user.id]);
  const data = await cachedJson(key, 15, async () => {
    const [
      deadLettered,
      audioNeedsTranscript,
      textNeedsFacts,
      eventNeedsEmbedding,
      failedDocuments,
      staleDocuments,
      failedMeetings,
      integrationErrors,
    ] = await Promise.all([
      db
        .select({ count: count() })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, active.teamId),
            sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ?| array['reconcile_giveup_transcribe','reconcile_giveup_extract','reconcile_giveup_embed']`,
          ),
        ),
      db
        .select({ count: count() })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, active.teamId),
            isNotNull(rawEvents.contentAudioUrl),
            sql`${rawEvents.contentText} IS NULL`,
          ),
        ),
      db
        .select({ count: count() })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, active.teamId),
            eq(rawEvents.visibility, 'team'),
            isNotNull(rawEvents.contentText),
            lt(rawEvents.createdAt, staleCutoff),
            sql`NOT (COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ? 'extracted_at')`,
            sql`NOT (COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ? 'extraction_skipped_at')`,
            notExists(
              db
                .select({ one: sql`1` })
                .from(factsTable)
                .where(eq(factsTable.rawEventId, rawEvents.id)),
            ),
          ),
        ),
      db
        .select({ count: count() })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, active.teamId),
            eq(rawEvents.visibility, 'team'),
            isNotNull(rawEvents.contentText),
            sql`NOT (COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ? 'embedded_at')`,
            sql`NOT (COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ? 'embedding_skipped_at')`,
          ),
        ),
      db
        .select({ count: count() })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.teamId, active.teamId),
            eq(documentVersions.processingStatus, 'failed'),
          ),
        ),
      db
        .select({ count: count() })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.teamId, active.teamId),
            sql`${documentVersions.processingStatus} IN ('pending','extracting')`,
            lt(documentVersions.createdAt, staleCutoff),
          ),
        ),
      db
        .select({ count: count() })
        .from(meetings)
        .where(and(eq(meetings.teamId, active.teamId), eq(meetings.status, 'failed'))),
      db
        .select({ count: count() })
        .from(integrations)
        .where(
          and(
            eq(integrations.teamId, active.teamId),
            isNotNull(integrations.lastError),
            sql`LOWER(${integrations.lastError}) NOT LIKE '%provider_rate_limited%'`,
            sql`LOWER(${integrations.lastError}) NOT LIKE '%github_rate_limited%'`,
            sql`LOWER(${integrations.lastError}) NOT LIKE '%monday_rate_limited%'`,
            sql`LOWER(${integrations.lastError}) NOT LIKE '%slack_rate_limited%'`,
            sql`LOWER(${integrations.lastError}) NOT LIKE '%daily_limit_exceeded%'`,
            sql`LOWER(${integrations.lastError}) NOT LIKE '%api rate limit exceeded%'`,
            sql`LOWER(${integrations.lastError}) NOT LIKE '%secondary rate limit%'`,
            sql`LOWER(${integrations.lastError}) NOT LIKE '%retry after%'`,
          ),
        ),
    ]);
    return {
      updatedAt: new Date().toISOString(),
      summaries: [
        {
          kind: 'transcription',
          label: 'Transcription',
          needsAttention: audioNeedsTranscript[0]?.count ?? 0,
        },
        { kind: 'extraction', label: 'Extraction', needsAttention: textNeedsFacts[0]?.count ?? 0 },
        {
          kind: 'embedding',
          label: 'Embedding',
          needsAttention: eventNeedsEmbedding[0]?.count ?? 0,
        },
        {
          kind: 'document_processing',
          label: 'Document processing',
          needsAttention: (failedDocuments[0]?.count ?? 0) + (staleDocuments[0]?.count ?? 0),
        },
        {
          kind: 'meeting_finalization',
          label: 'Meeting finalization',
          needsAttention: failedMeetings[0]?.count ?? 0,
        },
        {
          kind: 'integration_sync',
          label: 'Integration sync',
          needsAttention: integrationErrors[0]?.count ?? 0,
        },
        {
          kind: 'dead_lettered',
          label: 'Ignored/dead-lettered',
          needsAttention: deadLettered[0]?.count ?? 0,
        },
      ],
    };
  });
  return Response.json(data);
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = retrySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });
  const queue = await requireRedisQueue();

  if (parsed.data.kind === 'document_processing') {
    const version = await scope.documents.getDocumentVersion(parsed.data.id);
    if (!version) return Response.json({ error: 'not_found' }, { status: 404 });
    await queue.enqueueDocumentExtractJob({ documentVersionId: version.id, teamId: active.teamId });
    return Response.json({ ok: true });
  }

  const event = await scope.timeline.getEvent(parsed.data.id);
  if (!event) return Response.json({ error: 'not_found' }, { status: 404 });
  if (parsed.data.kind === 'transcription') {
    if (!event.contentAudioUrl) return Response.json({ error: 'not_audio' }, { status: 400 });
    await queue.enqueueTranscribeJob({
      rawEventId: event.id,
      teamId: active.teamId,
      audioKey: event.contentAudioUrl,
    });
  } else if (parsed.data.kind === 'extraction') {
    await queue.enqueueExtractJob({ rawEventId: event.id, teamId: active.teamId });
  } else {
    await queue.enqueueEmbedJob({ rawEventId: event.id, teamId: active.teamId });
  }
  return Response.json({ ok: true });
}
