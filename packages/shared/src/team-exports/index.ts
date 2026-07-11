import {
  auditLog,
  calendarEvents,
  documentVersions,
  documents,
  entities,
  facts,
  folders,
  integrationAuditLog,
  integrationSelections,
  integrationSyncState,
  integrations,
  mcpOutboundKeys,
  mcpOauthTokens,
  mcpServers,
  meetingTranscriptChunks,
  meetings,
  objectChanges,
  objectNotes,
  rawEvents,
  taskCategoryAssignments,
  type Db,
} from '@timeline/db';
import { and, asc, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import JSZip from 'jszip';

import { rawEventHiddenFromUser, rawEventVisibleToUser } from '#src/visibility.js';

const EXPORT_TTL_SEC = 24 * 60 * 60;

export interface ExportBuckets {
  attachments: string;
  audio: string;
  documents: string;
}

export interface SignedFileUrlInput {
  bucket: string;
  key: string;
  ttlSec: number;
}

export interface BuildTeamExportArchiveInput {
  db: Db;
  teamExportId: string;
  teamId: string;
  requestedByUserId: string;
  buckets: ExportBuckets;
  signFileUrl: (input: SignedFileUrlInput) => Promise<string>;
  now?: Date;
}

export interface BuildTeamExportArchiveResult {
  archive: Buffer;
  manifest: TeamExportManifest;
  omissions: TeamExportOmissions;
  signedFileCount: number;
}

export interface TeamExportManifest {
  export_id: string;
  team_id: string;
  requested_by_user_id: string;
  generated_at: string;
  expires_at: string;
  format_version: 1;
  files: Record<string, { rows?: number; bytes?: number }>;
  omissions: TeamExportOmissions;
}

export interface TeamExportOmissions {
  raw_events: number;
  facts: number;
  folders: number;
  documents: number;
  document_versions: number;
  meetings: number;
  calendar_events: number;
  files: number;
  integration_secrets: number;
}

type JsonRow = Record<string, unknown>;

function visibleRawEventFilter(teamId: string, userId: string) {
  return and(
    eq(rawEvents.teamId, teamId),
    sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
    rawEventVisibleToUser(userId),
  );
}

function hiddenRawEventFilter(teamId: string, userId: string) {
  return and(
    eq(rawEvents.teamId, teamId),
    sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
    rawEventHiddenFromUser(userId),
  );
}

function visibleDocumentFilter(teamId: string, userId: string) {
  return and(
    eq(documents.teamId, teamId),
    isNull(documents.deletedAt),
    or(
      eq(documents.visibility, 'team'),
      and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
      and(
        eq(documents.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${documents.visibilityUserIds})`,
      ),
    ),
  );
}

function hiddenDocumentFilter(teamId: string, userId: string) {
  return and(
    eq(documents.teamId, teamId),
    isNull(documents.deletedAt),
    or(
      and(
        eq(documents.visibility, 'private'),
        sql`${documents.ownerUserId} IS DISTINCT FROM ${userId}::uuid`,
      ),
      and(
        eq(documents.visibility, 'specific_users'),
        sql`NOT (${userId}::uuid = ANY(COALESCE(${documents.visibilityUserIds}, ARRAY[]::uuid[])))`,
      ),
    ),
  );
}

function visibleFolderFilter(teamId: string, userId: string) {
  return and(
    eq(folders.teamId, teamId),
    isNull(folders.deletedAt),
    or(
      eq(folders.visibility, 'team'),
      and(eq(folders.visibility, 'private'), eq(folders.ownerUserId, userId)),
      and(
        eq(folders.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${folders.visibilityUserIds})`,
      ),
    ),
  );
}

function hiddenFolderFilter(teamId: string, userId: string) {
  return and(
    eq(folders.teamId, teamId),
    isNull(folders.deletedAt),
    or(
      and(
        eq(folders.visibility, 'private'),
        sql`${folders.ownerUserId} IS DISTINCT FROM ${userId}::uuid`,
      ),
      and(
        eq(folders.visibility, 'specific_users'),
        sql`NOT (${userId}::uuid = ANY(COALESCE(${folders.visibilityUserIds}, ARRAY[]::uuid[])))`,
      ),
    ),
  );
}

function visibleMeetingFilter(teamId: string, userId: string) {
  return and(
    eq(meetings.teamId, teamId),
    or(
      eq(meetings.defaultVisibility, 'team'),
      and(eq(meetings.defaultVisibility, 'private'), eq(meetings.createdByUserId, userId)),
      and(
        eq(meetings.defaultVisibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${meetings.visibilityUserIds})`,
      ),
    ),
  );
}

function hiddenMeetingFilter(teamId: string, userId: string) {
  return and(
    eq(meetings.teamId, teamId),
    or(
      and(
        eq(meetings.defaultVisibility, 'private'),
        sql`${meetings.createdByUserId} IS DISTINCT FROM ${userId}::uuid`,
      ),
      and(
        eq(meetings.defaultVisibility, 'specific_users'),
        sql`NOT (${userId}::uuid = ANY(COALESCE(${meetings.visibilityUserIds}, ARRAY[]::uuid[])))`,
      ),
    ),
  );
}

function visibleCalendarEventFilter(teamId: string, userId: string) {
  return and(
    eq(calendarEvents.teamId, teamId),
    isNull(calendarEvents.deletedAt),
    or(
      eq(calendarEvents.visibility, 'team'),
      and(eq(calendarEvents.visibility, 'private'), eq(calendarEvents.createdByUserId, userId)),
      and(
        eq(calendarEvents.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${calendarEvents.visibilityUserIds})`,
      ),
    ),
  );
}

function hiddenCalendarEventFilter(teamId: string, userId: string) {
  return and(
    eq(calendarEvents.teamId, teamId),
    isNull(calendarEvents.deletedAt),
    or(
      and(
        eq(calendarEvents.visibility, 'private'),
        sql`${calendarEvents.createdByUserId} IS DISTINCT FROM ${userId}::uuid`,
      ),
      and(
        eq(calendarEvents.visibility, 'specific_users'),
        sql`NOT (${userId}::uuid = ANY(COALESCE(${calendarEvents.visibilityUserIds}, ARRAY[]::uuid[])))`,
      ),
    ),
  );
}

function jsonl(rows: unknown[]): string {
  if (rows.length === 0) return '';
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function omitKeys(row: Record<string, unknown>, keys: string[]): JsonRow {
  const out: JsonRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (!keys.includes(key)) out[key] = value;
  }
  return out;
}

function addJsonl(zip: JSZip, name: string, rows: unknown[]): { rows: number; bytes: number } {
  const body = jsonl(rows);
  zip.file(name, body);
  return { rows: rows.length, bytes: Buffer.byteLength(body) };
}

async function visibleRawEvents(db: Db, teamId: string, userId: string) {
  return db
    .select()
    .from(rawEvents)
    .where(visibleRawEventFilter(teamId, userId))
    .orderBy(asc(rawEvents.occurredAt), asc(rawEvents.id));
}

async function visibleDocuments(db: Db, teamId: string, userId: string) {
  return db
    .select()
    .from(documents)
    .where(visibleDocumentFilter(teamId, userId))
    .orderBy(asc(documents.createdAt), asc(documents.id));
}

function attachmentRecords(event: { id: string; sourceMetadata: unknown }): JsonRow[] {
  const metadata = event.sourceMetadata;
  if (!metadata || typeof metadata !== 'object' || !('attachments' in metadata)) return [];
  const attachments = (metadata as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== 'object') return [];
    const record = attachment as Record<string, unknown>;
    if (record.upload_failed === true || typeof record.key !== 'string') return [];
    if (record.bucket !== 'attachments' && record.bucket !== 'audio') return [];
    return [{ ...record, raw_event_id: event.id }];
  });
}

export async function buildTeamExportArchive(
  input: BuildTeamExportArchiveInput,
): Promise<BuildTeamExportArchiveResult> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + EXPORT_TTL_SEC * 1000);
  const zip = new JSZip();
  const files: TeamExportManifest['files'] = {};

  const events = await visibleRawEvents(input.db, input.teamId, input.requestedByUserId);
  files['raw_events.jsonl'] = addJsonl(zip, 'raw_events.jsonl', events);
  const eventIds = events.map((event) => event.id);

  const factRows =
    eventIds.length > 0
      ? await input.db
          .select()
          .from(facts)
          .where(and(eq(facts.teamId, input.teamId), inArray(facts.rawEventId, eventIds)))
          .orderBy(asc(facts.extractedAt), asc(facts.id))
      : [];
  files['facts.jsonl'] = addJsonl(zip, 'facts.jsonl', factRows);

  const objectRows = await input.db
    .select()
    .from(entities)
    .where(eq(entities.teamId, input.teamId))
    .orderBy(asc(entities.createdAt), asc(entities.id));
  files['objects.jsonl'] = addJsonl(
    zip,
    'objects.jsonl',
    objectRows.filter((row) => row.type !== 'task' && row.type !== 'follow_up'),
  );
  files['tasks.jsonl'] = addJsonl(
    zip,
    'tasks.jsonl',
    objectRows.filter((row) => row.type === 'task' || row.type === 'follow_up'),
  );

  const noteRows = await input.db
    .select()
    .from(objectNotes)
    .where(and(eq(objectNotes.teamId, input.teamId), isNull(objectNotes.deletedAt)))
    .orderBy(asc(objectNotes.createdAt), asc(objectNotes.id));
  files['object_notes.jsonl'] = addJsonl(zip, 'object_notes.jsonl', noteRows);

  const changeRows = await input.db
    .select()
    .from(objectChanges)
    .where(eq(objectChanges.teamId, input.teamId))
    .orderBy(asc(objectChanges.changedAt), asc(objectChanges.id));
  files['object_changes.jsonl'] = addJsonl(zip, 'object_changes.jsonl', changeRows);

  const categoryAssignmentRows = await input.db
    .select()
    .from(taskCategoryAssignments)
    .where(eq(taskCategoryAssignments.teamId, input.teamId))
    .orderBy(asc(taskCategoryAssignments.createdAt), asc(taskCategoryAssignments.id));
  files['task_category_assignments.jsonl'] = addJsonl(
    zip,
    'task_category_assignments.jsonl',
    categoryAssignmentRows,
  );

  const docRows = await visibleDocuments(input.db, input.teamId, input.requestedByUserId);
  files['documents.jsonl'] = addJsonl(zip, 'documents.jsonl', docRows);
  const docIds = docRows.map((doc) => doc.id);

  const folderRows = await input.db
    .select()
    .from(folders)
    .where(visibleFolderFilter(input.teamId, input.requestedByUserId))
    .orderBy(asc(folders.createdAt), asc(folders.id));
  files['folders.jsonl'] = addJsonl(zip, 'folders.jsonl', folderRows);

  const versionRows =
    docIds.length > 0
      ? await input.db
          .select()
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.teamId, input.teamId),
              inArray(documentVersions.documentId, docIds),
            ),
          )
          .orderBy(asc(documentVersions.createdAt), asc(documentVersions.id))
      : [];
  files['document_versions.jsonl'] = addJsonl(zip, 'document_versions.jsonl', versionRows);

  const meetingRows = await input.db
    .select()
    .from(meetings)
    .where(visibleMeetingFilter(input.teamId, input.requestedByUserId))
    .orderBy(asc(meetings.createdAt), asc(meetings.id));
  files['meetings.jsonl'] = addJsonl(zip, 'meetings.jsonl', meetingRows);
  const meetingIds = meetingRows.map((meeting) => meeting.id);

  const meetingChunkRows =
    meetingIds.length > 0
      ? await input.db
          .select()
          .from(meetingTranscriptChunks)
          .where(
            and(
              eq(meetingTranscriptChunks.teamId, input.teamId),
              inArray(meetingTranscriptChunks.meetingId, meetingIds),
            ),
          )
          .orderBy(asc(meetingTranscriptChunks.createdAt), asc(meetingTranscriptChunks.id))
      : [];
  files['meeting_transcript_chunks.jsonl'] = addJsonl(
    zip,
    'meeting_transcript_chunks.jsonl',
    meetingChunkRows,
  );

  const calendarRows = await input.db
    .select()
    .from(calendarEvents)
    .where(visibleCalendarEventFilter(input.teamId, input.requestedByUserId))
    .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id));
  files['calendar_events.jsonl'] = addJsonl(zip, 'calendar_events.jsonl', calendarRows);

  const integrationRows = await input.db
    .select()
    .from(integrations)
    .where(eq(integrations.teamId, input.teamId))
    .orderBy(asc(integrations.createdAt), asc(integrations.id));
  const integrationIds = integrationRows.map((row) => row.id);
  const syncRows =
    integrationIds.length > 0
      ? await input.db
          .select()
          .from(integrationSyncState)
          .where(inArray(integrationSyncState.integrationId, integrationIds))
      : [];
  const selectionRows =
    integrationIds.length > 0
      ? await input.db
          .select()
          .from(integrationSelections)
          .where(inArray(integrationSelections.integrationId, integrationIds))
      : [];
  const mcpRows = await input.db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.teamId, input.teamId))
    .orderBy(asc(mcpServers.createdAt), asc(mcpServers.id));
  const outboundKeyRows = await input.db
    .select()
    .from(mcpOutboundKeys)
    .where(eq(mcpOutboundKeys.teamId, input.teamId))
    .orderBy(asc(mcpOutboundKeys.createdAt), asc(mcpOutboundKeys.id));
  files['integrations.jsonl'] = addJsonl(zip, 'integrations.jsonl', [
    ...integrationRows.map((row) => ({
      kind: 'integration',
      ...omitKeys(row, ['authSecretCiphertext', 'authSecretIv', 'authSecretTag']),
      secrets_omitted: Boolean(row.authSecretCiphertext),
    })),
    ...syncRows.map((row) => ({ kind: 'integration_sync_state', ...row })),
    ...selectionRows.map((row) => ({ kind: 'integration_selection', ...row })),
    ...mcpRows.map((row) => ({
      kind: 'mcp_server',
      ...omitKeys(row, ['authConfigCiphertext', 'authConfigIv', 'authConfigTag']),
      secrets_omitted: Boolean(row.authConfigCiphertext),
    })),
    ...outboundKeyRows.map((row) => ({
      kind: 'mcp_outbound_key',
      ...omitKeys(row, ['keyHash']),
      key_hash_omitted: true,
    })),
  ]);

  const auditRows = await input.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.teamId, input.teamId))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
  const integrationAuditRows = await input.db
    .select()
    .from(integrationAuditLog)
    .where(eq(integrationAuditLog.teamId, input.teamId))
    .orderBy(asc(integrationAuditLog.createdAt), asc(integrationAuditLog.id));
  files['audit_log.jsonl'] = addJsonl(zip, 'audit_log.jsonl', [
    ...auditRows.map((row) => ({ kind: 'trust_audit', ...row })),
    ...integrationAuditRows.map((row) => ({
      kind: 'integration_audit',
      integration_audit_kind: row.kind,
      ...omitKeys(row, ['kind']),
    })),
  ]);

  const fileRows: JsonRow[] = [];
  for (const version of versionRows) {
    fileRows.push({
      kind: 'document_version',
      document_id: version.documentId,
      document_version_id: version.id,
      bucket: input.buckets.documents,
      key: version.objectKey,
      url: await input.signFileUrl({
        bucket: input.buckets.documents,
        key: version.objectKey,
        ttlSec: EXPORT_TTL_SEC,
      }),
      expires_at: expiresAt.toISOString(),
    });
  }
  for (const event of events) {
    if (event.contentAudioUrl) {
      fileRows.push({
        kind: 'raw_event_audio',
        raw_event_id: event.id,
        bucket: input.buckets.audio,
        key: event.contentAudioUrl,
        url: await input.signFileUrl({
          bucket: input.buckets.audio,
          key: event.contentAudioUrl,
          ttlSec: EXPORT_TTL_SEC,
        }),
        expires_at: expiresAt.toISOString(),
      });
    }
    for (const attachment of attachmentRecords(event)) {
      const bucket =
        attachment.bucket === 'audio' ? input.buckets.audio : input.buckets.attachments;
      fileRows.push({
        ...attachment,
        kind: 'email_attachment',
        bucket,
        url: await input.signFileUrl({
          bucket,
          key: String(attachment.key),
          ttlSec: EXPORT_TTL_SEC,
        }),
        expires_at: expiresAt.toISOString(),
      });
    }
  }
  files['files.jsonl'] = addJsonl(zip, 'files.jsonl', fileRows);

  const hiddenEventFileRows = await input.db
    .select({
      id: rawEvents.id,
      contentAudioUrl: rawEvents.contentAudioUrl,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(hiddenRawEventFilter(input.teamId, input.requestedByUserId));
  const hiddenDocsRows = await input.db
    .select({ value: count() })
    .from(documents)
    .where(hiddenDocumentFilter(input.teamId, input.requestedByUserId));
  const hiddenFolderRows = await input.db
    .select({ value: count() })
    .from(folders)
    .where(hiddenFolderFilter(input.teamId, input.requestedByUserId));
  const hiddenFactsRows = await input.db
    .select({ value: count() })
    .from(facts)
    .innerJoin(rawEvents, eq(facts.rawEventId, rawEvents.id))
    .where(hiddenRawEventFilter(input.teamId, input.requestedByUserId));
  const hiddenDocVersionRows = await input.db
    .select({ value: count() })
    .from(documentVersions)
    .innerJoin(documents, eq(documentVersions.documentId, documents.id))
    .where(hiddenDocumentFilter(input.teamId, input.requestedByUserId));
  const hiddenMeetingRows = await input.db
    .select({ value: count() })
    .from(meetings)
    .where(hiddenMeetingFilter(input.teamId, input.requestedByUserId));
  const hiddenCalendarRows = await input.db
    .select({ value: count() })
    .from(calendarEvents)
    .where(hiddenCalendarEventFilter(input.teamId, input.requestedByUserId));
  const oauthRows = await input.db
    .select({ value: count() })
    .from(mcpOauthTokens)
    .where(eq(mcpOauthTokens.teamId, input.teamId));
  const hiddenFileCount =
    (hiddenDocVersionRows[0]?.value ?? 0) +
    hiddenEventFileRows.reduce(
      (total, event) => total + (event.contentAudioUrl ? 1 : 0) + attachmentRecords(event).length,
      0,
    );
  const omissions: TeamExportOmissions = {
    raw_events: hiddenEventFileRows.length,
    facts: hiddenFactsRows[0]?.value ?? 0,
    folders: hiddenFolderRows[0]?.value ?? 0,
    documents: hiddenDocsRows[0]?.value ?? 0,
    document_versions: hiddenDocVersionRows[0]?.value ?? 0,
    meetings: hiddenMeetingRows[0]?.value ?? 0,
    calendar_events: hiddenCalendarRows[0]?.value ?? 0,
    files: hiddenFileCount,
    integration_secrets:
      integrationRows.filter((row) => row.authSecretCiphertext).length +
      mcpRows.filter((row) => row.authConfigCiphertext).length +
      outboundKeyRows.length +
      (oauthRows[0]?.value ?? 0),
  };

  const readme = [
    'The Timeline team export',
    '',
    'This archive contains JSON/JSONL data visible to the admin who requested it.',
    'Private or restricted records the requester could not already see are omitted.',
    'Binary files are not embedded. files.jsonl contains signed URLs that expire after 24 hours.',
    'Integration OAuth tokens, bearer keys, auth headers, and encrypted secrets are never exported in plaintext.',
    '',
  ].join('\n');
  zip.file('README.txt', readme);
  files['README.txt'] = { bytes: Buffer.byteLength(readme) };

  const manifest: TeamExportManifest = {
    export_id: input.teamExportId,
    team_id: input.teamId,
    requested_by_user_id: input.requestedByUserId,
    generated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    format_version: 1,
    files,
    omissions,
  };
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  zip.file('manifest.json', manifestBody);
  manifest.files['manifest.json'] = { bytes: Buffer.byteLength(manifestBody) };

  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { archive, manifest, omissions, signedFileCount: fileRows.length };
}

export function buildTeamExportObjectKey(teamId: string, teamExportId: string): string {
  return `team-exports/${teamId}/${teamExportId}.zip`;
}
