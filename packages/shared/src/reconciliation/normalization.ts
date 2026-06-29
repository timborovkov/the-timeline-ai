import { createHash } from 'node:crypto';

import {
  type Db,
  rawEvents,
  reconciliationEvidence,
  reconciliationEvidenceAnchors,
} from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { IntegrationEvent } from '#src/integrations/types.js';

import { buildEvidenceDedupeKey, reconciliationDedupeKey } from '#src/reconciliation/index.js';

const INTEGRATION_NORMALIZER_VERSION = 'integration-normalize-2026-06';
const RAW_EVENT_NORMALIZER_VERSION = 'raw-event-normalize-2026-06';
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export interface NormalizeIntegrationEventsInput {
  db: DbOrTx;
  teamId: string;
  events: IntegrationEvent[];
  rawEventIdsByDedupKey: Map<string, string>;
  normalizerVersion?: string;
}

export interface NormalizeRawEventsInput {
  db: DbOrTx;
  teamId: string;
  rawEventIds: string[];
  normalizerVersion?: string;
}

interface NormalizedAnchor {
  anchorType: string;
  anchorValue: string;
  strength: 'hard' | 'provider' | 'structured' | 'semantic' | 'human';
}

export async function normalizeIntegrationEventsToEvidence(
  input: NormalizeIntegrationEventsInput,
): Promise<string[]> {
  const normalizerVersion = input.normalizerVersion ?? INTEGRATION_NORMALIZER_VERSION;
  const events = input.events.filter((event) => input.rawEventIdsByDedupKey.has(event.dedupKey));
  if (events.length === 0) return [];

  const rawEventIds = events
    .map((event) => input.rawEventIdsByDedupKey.get(event.dedupKey))
    .filter((id): id is string => Boolean(id));
  const rawRows = await input.db
    .select({
      id: rawEvents.id,
      source: rawEvents.source,
      contentText: rawEvents.contentText,
      occurredAt: rawEvents.occurredAt,
      visibility: rawEvents.visibility,
      visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
      visibilityUserIds: rawEvents.visibilityUserIds,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(and(eq(rawEvents.teamId, input.teamId), inArray(rawEvents.id, rawEventIds)));
  const rawById = new Map(rawRows.map((row) => [row.id, row]));

  const evidenceValues = events.flatMap((event) => {
    const rawEventId = input.rawEventIdsByDedupKey.get(event.dedupKey);
    const raw = rawEventId ? rawById.get(rawEventId) : null;
    if (!rawEventId || !raw) return [];
    const sourcePayloadRef =
      metadataString(event.extra, 'source_payload_ref') ??
      metadataString(event.extra, 'payload_ref');
    const payloadDigest =
      metadataString(event.extra, 'payload_digest') ??
      metadataString(event.extra, 'source_payload_digest');
    return [
      {
        teamId: input.teamId,
        rawEventId,
        sourcePayloadRef,
        payloadDigest,
        source: raw.source,
        provider: event.provider,
        externalObjectId: event.externalObjectId,
        externalEventId: event.externalEventId ?? null,
        eventType: event.eventType,
        occurredAt: raw.occurredAt,
        visibility: raw.visibility,
        visibilityOwnerUserId: raw.visibilityOwnerUserId,
        visibilityUserIds: raw.visibilityUserIds,
        actor: event.actor ?? {},
        contentDigest: contentDigest({
          contentText: raw.contentText,
          sourceMetadata: raw.sourceMetadata,
        }),
        title: integrationEvidenceTitle(event),
        summary: raw.contentText,
        sourceUrl: metadataString(event.extra, 'url') ?? event.objectMap?.url ?? null,
        metadata: {
          provider: event.provider,
          integration_event_type: event.eventType,
          integration_dedup_key: event.dedupKey,
          replay_degraded_reason: sourcePayloadRef ? null : 'missing_source_payload_ref',
        },
        normalizerVersion,
        replayState: sourcePayloadRef ? 'full' : 'degraded',
        dedupeKey: buildEvidenceDedupeKey({
          teamId: input.teamId,
          source: raw.source,
          rawEventId,
          sourcePayloadDigest: payloadDigest,
          normalizerVersion,
        }),
      } satisfies typeof reconciliationEvidence.$inferInsert,
    ];
  });

  if (evidenceValues.length === 0) return [];

  await upsertEvidenceValues(input.db, evidenceValues);

  const dedupeKeys = evidenceValues.map((value) => value.dedupeKey);
  const evidenceRows = await input.db
    .select({
      id: reconciliationEvidence.id,
      rawEventId: reconciliationEvidence.rawEventId,
      dedupeKey: reconciliationEvidence.dedupeKey,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, input.teamId),
        inArray(reconciliationEvidence.dedupeKey, dedupeKeys),
      ),
    );
  const evidenceByRawEventId = new Map(evidenceRows.map((row) => [row.rawEventId, row.id]));

  const anchorValues = events.flatMap((event) => {
    const rawEventId = input.rawEventIdsByDedupKey.get(event.dedupKey);
    const evidenceId = rawEventId ? evidenceByRawEventId.get(rawEventId) : null;
    if (!evidenceId) return [];
    return anchorsForIntegrationEvent(event).map((anchor) => ({
      teamId: input.teamId,
      evidenceId,
      anchorType: anchor.anchorType,
      anchorValue: anchor.anchorValue,
      strength: anchor.strength,
      confidence: 'high',
      source: 'adapter' as const,
      metadata: {
        provider: event.provider,
        event_type: event.eventType,
      },
      dedupeKey: reconciliationDedupeKey('anchor', {
        teamId: input.teamId,
        evidenceId,
        anchorType: anchor.anchorType,
        anchorValue: anchor.anchorValue,
        source: 'adapter',
      }),
    }));
  });

  if (anchorValues.length > 0) {
    await input.db
      .insert(reconciliationEvidenceAnchors)
      .values(uniqueAnchors(anchorValues))
      .onConflictDoNothing();
  }

  return evidenceRows.map((row) => row.id);
}

export async function normalizeRawEventsToEvidence(
  input: NormalizeRawEventsInput,
): Promise<string[]> {
  const rawEventIds = [...new Set(input.rawEventIds)].filter((id) => id.trim().length > 0);
  if (rawEventIds.length === 0) return [];

  const normalizerVersion = input.normalizerVersion ?? RAW_EVENT_NORMALIZER_VERSION;
  const rawRows = await input.db
    .select({
      id: rawEvents.id,
      source: rawEvents.source,
      contentText: rawEvents.contentText,
      contentAudioUrl: rawEvents.contentAudioUrl,
      occurredAt: rawEvents.occurredAt,
      visibility: rawEvents.visibility,
      visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
      visibilityUserIds: rawEvents.visibilityUserIds,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(and(eq(rawEvents.teamId, input.teamId), inArray(rawEvents.id, rawEventIds)));
  if (rawRows.length === 0) return [];

  const evidenceValues = rawRows.map((raw) => {
    const metadata = recordField(raw.sourceMetadata) ?? {};
    const sourcePayloadRef = sourcePayloadRefForMetadata(metadata);
    const payloadDigest = payloadDigestForMetadata(metadata);
    const provider = rawProvider(raw.source, metadata);
    const eventType = rawEventType(raw.source, metadata);
    const externalObjectId = rawExternalObjectId(raw.source, metadata) ?? raw.id;
    const inlineReplay = hasInlineReplaySnapshot(raw.source, metadata, raw.contentText);
    return {
      teamId: input.teamId,
      rawEventId: raw.id,
      sourcePayloadRef,
      payloadDigest,
      source: raw.source,
      provider,
      externalObjectId,
      externalEventId: rawExternalEventId(raw.source, metadata),
      eventType,
      occurredAt: raw.occurredAt,
      visibility: raw.visibility,
      visibilityOwnerUserId: raw.visibilityOwnerUserId,
      visibilityUserIds: raw.visibilityUserIds,
      actor: rawActor(metadata),
      contentDigest: contentDigest({
        contentText: raw.contentText,
        contentAudioUrl: raw.contentAudioUrl,
        sourceMetadata: raw.sourceMetadata,
      }),
      title: rawEvidenceTitle(raw.source, metadata),
      summary: raw.contentText,
      sourceUrl: rawSourceUrl(metadata),
      metadata: {
        source: raw.source,
        provider,
        event_type: eventType,
        replay_degraded_reason:
          sourcePayloadRef || inlineReplay ? null : 'missing_source_payload_ref',
      },
      normalizerVersion,
      replayState: sourcePayloadRef || inlineReplay ? 'full' : 'degraded',
      dedupeKey: buildEvidenceDedupeKey({
        teamId: input.teamId,
        source: raw.source,
        rawEventId: raw.id,
        sourcePayloadDigest: payloadDigest,
        normalizerVersion,
      }),
    } satisfies typeof reconciliationEvidence.$inferInsert;
  });

  await upsertEvidenceValues(input.db, evidenceValues);

  const evidenceRows = await input.db
    .select({
      id: reconciliationEvidence.id,
      rawEventId: reconciliationEvidence.rawEventId,
      dedupeKey: reconciliationEvidence.dedupeKey,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, input.teamId),
        inArray(
          reconciliationEvidence.dedupeKey,
          evidenceValues.map((value) => value.dedupeKey),
        ),
      ),
    );
  const evidenceByRawEventId = new Map(evidenceRows.map((row) => [row.rawEventId, row.id]));

  const anchorValues = rawRows.flatMap((raw) => {
    const evidenceId = evidenceByRawEventId.get(raw.id);
    if (!evidenceId) return [];
    const metadata = recordField(raw.sourceMetadata) ?? {};
    return anchorsForRawEvent(raw, metadata).map((anchor) => ({
      teamId: input.teamId,
      evidenceId,
      anchorType: anchor.anchorType,
      anchorValue: anchor.anchorValue,
      strength: anchor.strength,
      confidence: 'high',
      source: 'adapter' as const,
      metadata: {
        source: raw.source,
        provider: rawProvider(raw.source, metadata),
      },
      dedupeKey: reconciliationDedupeKey('anchor', {
        teamId: input.teamId,
        evidenceId,
        anchorType: anchor.anchorType,
        anchorValue: anchor.anchorValue,
        source: 'adapter',
      }),
    }));
  });

  if (anchorValues.length > 0) {
    await input.db
      .insert(reconciliationEvidenceAnchors)
      .values(uniqueAnchors(anchorValues))
      .onConflictDoNothing();
  }

  return evidenceRows.map((row) => row.id);
}

function anchorsForIntegrationEvent(event: IntegrationEvent): NormalizedAnchor[] {
  const anchors: NormalizedAnchor[] = [
    {
      anchorType: 'provider_object',
      anchorValue: `${event.provider}:${event.externalObjectId}`,
      strength: 'provider',
    },
  ];

  if (event.externalEventId) {
    anchors.push({
      anchorType: 'provider_event',
      anchorValue: `${event.provider}:${event.externalEventId}`,
      strength: 'provider',
    });
  }

  if (event.objectMap) {
    anchors.push({
      anchorType: `provider_external:${event.provider}`,
      anchorValue: event.objectMap.externalId,
      strength: 'hard',
    });
    for (const alias of event.objectMap.aliases ?? []) {
      anchors.push({
        anchorType: `alias:${event.objectMap.type}`,
        anchorValue: alias,
        strength: 'structured',
      });
    }
    const artifactKey = metadataString(event.objectMap.metadata, 'artifact_key');
    if (artifactKey)
      anchors.push({ anchorType: 'artifact_key', anchorValue: artifactKey, strength: 'hard' });
    if (event.objectMap.url) {
      anchors.push({
        anchorType: 'url',
        anchorValue: normalizeUrlAnchor(event.objectMap.url),
        strength: 'hard',
      });
    }
  }

  const repo =
    metadataString(event.extra, 'repo') ??
    metadataString(recordField(event.extra, 'github'), 'repo');
  if (repo) anchors.push({ anchorType: 'repo', anchorValue: repo, strength: 'structured' });

  return uniqueNormalizedAnchors(anchors);
}

function integrationEvidenceTitle(event: IntegrationEvent): string {
  return (
    event.objectMap?.displayTitle ??
    event.objectMap?.canonicalName ??
    `${event.provider} ${event.eventType}`
  );
}

function rawProvider(source: string, metadata: Record<string, unknown>): string | null {
  return metadataString(metadata, 'provider') ?? (source === 'integration' ? null : source);
}

function rawEventType(source: string, metadata: Record<string, unknown>): string {
  const explicit =
    metadataString(metadata, 'event_type') ??
    metadataString(metadata, 'action') ??
    metadataString(metadata, 'type') ??
    metadataString(metadata, 'kind');
  if (explicit) return `${source}.${explicit}`;
  if (source === 'email') return 'email.received';
  if (source === 'slack') {
    const attachmentKind = metadataString(metadata, 'slack_attachment_kind');
    return attachmentKind ? `slack.${attachmentKind}` : 'slack.message';
  }
  if (source === 'telegram') {
    const attachmentKind = metadataString(metadata, 'tg_attachment_kind');
    return attachmentKind ? `telegram.${attachmentKind}` : 'telegram.message';
  }
  if (source === 'ingest_webhook') return 'ingest_webhook.received';
  if (source === 'meeting') return 'meeting.finalized';
  if (source === 'document') return 'document.activity';
  if (source === 'calendar') return 'calendar.event';
  if (source === 'web') return 'web.note';
  return `${source}.event`;
}

function rawExternalObjectId(source: string, metadata: Record<string, unknown>): string | null {
  if (source === 'email') return metadataString(metadata, 'message_id');
  if (source === 'slack') {
    const workspace = metadataString(metadata, 'slack_workspace_id');
    const channel = metadataString(metadata, 'slack_channel_id');
    const ts = metadataString(metadata, 'slack_message_ts');
    if (workspace && channel && ts) return `${workspace}:${channel}:${ts}`;
  }
  if (source === 'telegram') {
    const chat = metadataScalar(metadata, 'tg_chat_id');
    const message = metadataScalar(metadata, 'tg_message_id');
    if (chat && message) return `${chat}:${message}`;
  }
  if (source === 'ingest_webhook') {
    return (
      metadataString(metadata, 'ingest_webhook_dedup_key') ??
      metadataString(metadata, 'ingest_webhook_id')
    );
  }
  if (source === 'meeting') return metadataString(metadata, 'meeting_chunk_provider_id');
  if (source === 'document') {
    return (
      metadataString(metadata, 'document_version_id') ?? metadataString(metadata, 'document_id')
    );
  }
  if (source === 'calendar') return metadataString(metadata, 'calendar_event_id');
  if (source === 'system') {
    return (
      metadataString(metadata, 'entity_id') ??
      metadataString(metadata, 'relationship_id') ??
      metadataString(metadata, 'note_id') ??
      metadataString(metadata, 'identity_facet_id')
    );
  }
  return (
    metadataString(metadata, 'external_object_id') ??
    metadataString(metadata, 'source_object_id') ??
    metadataString(metadata, 'object_id')
  );
}

function rawExternalEventId(source: string, metadata: Record<string, unknown>): string | null {
  if (source === 'slack') return metadataString(metadata, 'slack_event_id');
  if (source === 'telegram') return metadataScalar(metadata, 'tg_update_id');
  if (source === 'email') return metadataString(metadata, 'message_id');
  if (source === 'ingest_webhook') return metadataString(metadata, 'ingest_webhook_dedup_key');
  return (
    metadataString(metadata, 'external_event_id') ??
    metadataString(metadata, 'event_id') ??
    metadataString(metadata, 'dedup_key')
  );
}

function rawEvidenceTitle(source: string, metadata: Record<string, unknown>): string {
  if (source === 'email') return metadataString(metadata, 'subject') ?? 'Email';
  if (source === 'slack') {
    return (
      metadataString(metadata, 'slack_channel_name') ??
      metadataString(metadata, 'slack_channel_id') ??
      'Slack message'
    );
  }
  if (source === 'telegram') {
    return (
      metadataString(metadata, 'tg_chat_title') ??
      metadataString(metadata, 'tg_sender_name') ??
      'Telegram message'
    );
  }
  if (source === 'ingest_webhook')
    return metadataString(metadata, 'ingest_webhook_name') ?? 'Ingest webhook event';
  if (source === 'meeting')
    return metadataString(metadata, 'meeting_title') ?? 'Meeting transcript';
  if (source === 'document') return metadataString(metadata, 'document_title') ?? 'Document event';
  if (source === 'calendar') return metadataString(metadata, 'calendar_title') ?? 'Calendar event';
  return `${source} event`;
}

function rawActor(metadata: Record<string, unknown>): Record<string, unknown> {
  const actor = recordField(metadata, 'actor');
  if (actor) return actor;
  const result: Record<string, unknown> = {};
  for (const key of [
    'from',
    'from_email',
    'sender_email',
    'sender_name',
    'slack_user_id',
    'slack_user_name',
    'tg_user_id',
    'tg_username',
    'tg_sender_name',
  ]) {
    if (metadata[key] !== undefined) result[key] = metadata[key];
  }
  return result;
}

function rawSourceUrl(metadata: Record<string, unknown>): string | null {
  return (
    metadataString(metadata, 'url') ??
    metadataString(metadata, 'permalink') ??
    metadataString(metadata, 'source_url')
  );
}

function sourcePayloadRefForMetadata(metadata: Record<string, unknown>): string | null {
  return (
    metadataString(metadata, 'source_payload_ref') ??
    metadataString(metadata, 'payload_ref') ??
    metadataString(metadata, 'raw_payload_ref') ??
    metadataString(metadata, 'source_snapshot_ref')
  );
}

function payloadDigestForMetadata(metadata: Record<string, unknown>): string | null {
  return (
    metadataString(metadata, 'payload_digest') ??
    metadataString(metadata, 'source_payload_digest') ??
    metadataString(metadata, 'raw_payload_digest') ??
    metadataString(metadata, 'ingest_webhook_body_sha256')
  );
}

function hasInlineReplaySnapshot(
  source: string,
  metadata: Record<string, unknown>,
  contentText: string | null,
): boolean {
  if (recordField(metadata, 'raw_postmark')) return true;
  if (recordField(metadata, 'raw_payload')) return true;
  if (recordField(metadata, 'source_snapshot')) return true;
  return source === 'ingest_webhook' && Boolean(contentText);
}

function anchorsForRawEvent(
  raw: {
    id: string;
    source: string;
  },
  metadata: Record<string, unknown>,
): NormalizedAnchor[] {
  const anchors: NormalizedAnchor[] = [
    { anchorType: 'raw_event', anchorValue: raw.id, strength: 'hard' },
  ];
  const externalObjectId = rawExternalObjectId(raw.source, metadata);
  if (externalObjectId) {
    anchors.push({
      anchorType: `source_object:${raw.source}`,
      anchorValue: externalObjectId,
      strength: 'provider',
    });
  }
  addAnchor(anchors, 'email_message', metadataString(metadata, 'message_id'), 'provider');
  addAnchor(anchors, 'email_thread', metadataString(metadata, 'thread_root_id'), 'structured');
  for (const email of emailAddressesFromMetadata(metadata)) {
    addAnchor(anchors, 'email_address', email, 'structured');
    const domain = email.split('@')[1];
    addAnchor(anchors, 'email_domain', domain, 'structured');
  }
  addAnchor(anchors, 'slack_workspace', metadataString(metadata, 'slack_workspace_id'), 'provider');
  addAnchor(anchors, 'slack_channel', metadataString(metadata, 'slack_channel_id'), 'provider');
  addAnchor(anchors, 'slack_thread', metadataString(metadata, 'slack_thread_ts'), 'structured');
  addAnchor(anchors, 'slack_user', metadataString(metadata, 'slack_user_id'), 'structured');
  addAnchor(anchors, 'telegram_chat', metadataScalar(metadata, 'tg_chat_id'), 'provider');
  addAnchor(anchors, 'telegram_user', metadataScalar(metadata, 'tg_user_id'), 'structured');
  addAnchor(anchors, 'ingest_webhook', metadataString(metadata, 'ingest_webhook_id'), 'provider');
  addAnchor(anchors, 'artifact_key', metadataString(metadata, 'artifact_key'), 'hard');
  addAnchor(
    anchors,
    'meeting_provider',
    metadataString(metadata, 'meeting_chunk_provider_id'),
    'provider',
  );
  addAnchor(anchors, 'document', metadataString(metadata, 'document_id'), 'provider');
  addAnchor(
    anchors,
    'document_version',
    metadataString(metadata, 'document_version_id'),
    'provider',
  );
  addAnchor(anchors, 'calendar_event', metadataString(metadata, 'calendar_event_id'), 'provider');
  addAnchor(anchors, 'object', metadataString(metadata, 'entity_id'), 'structured');
  addAnchor(anchors, 'relationship', metadataString(metadata, 'relationship_id'), 'structured');
  addAnchor(anchors, 'object_note', metadataString(metadata, 'note_id'), 'structured');
  addAnchor(anchors, 'identity_facet', metadataString(metadata, 'identity_facet_id'), 'structured');
  const url = rawSourceUrl(metadata);
  addAnchor(anchors, 'url', url ? normalizeUrlAnchor(url) : null, 'hard');
  return uniqueNormalizedAnchors(anchors);
}

function addAnchor(
  anchors: NormalizedAnchor[],
  anchorType: string,
  anchorValue: string | null | undefined,
  strength: NormalizedAnchor['strength'],
): void {
  if (!anchorValue) return;
  anchors.push({ anchorType, anchorValue, strength });
}

function emailAddressesFromMetadata(metadata: Record<string, unknown>): string[] {
  const values = [
    metadataString(metadata, 'from_email'),
    metadataString(metadata, 'sender_email'),
    metadataString(metadata, 'from'),
  ];
  for (const key of ['to', 'cc', 'recipients']) {
    const value = metadata[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') values.push(item);
        else values.push(metadataString(item, 'email'));
      }
    }
  }
  return [
    ...new Set(
      values.filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()),
    ),
  ];
}

function contentDigest(input: {
  contentText: string | null;
  contentAudioUrl?: string | null;
  sourceMetadata: unknown;
}): string {
  return `sha256:${createHash('sha256').update(stableJson(input)).digest('hex')}`;
}

function metadataString(value: unknown, key: string): string | null {
  const record = recordField(value);
  if (!record) return null;
  const field = record[key];
  return typeof field === 'string' && field.trim().length > 0 ? field : null;
}

function metadataScalar(value: unknown, key: string): string | null {
  const record = recordField(value);
  if (!record) return null;
  const field = record[key];
  if (typeof field === 'string' && field.trim().length > 0) return field;
  if (typeof field === 'number' || typeof field === 'bigint') return String(field);
  return null;
}

function recordField(value: unknown, key?: string): Record<string, unknown> | null {
  const candidate =
    key && value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function normalizeUrlAnchor(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

function uniqueNormalizedAnchors(anchors: NormalizedAnchor[]): NormalizedAnchor[] {
  const seen = new Set<string>();
  const result: NormalizedAnchor[] = [];
  for (const anchor of anchors) {
    const normalized = {
      ...anchor,
      anchorType: anchor.anchorType.trim().toLowerCase(),
      anchorValue: anchor.anchorValue.trim().toLowerCase(),
    };
    if (!normalized.anchorType || !normalized.anchorValue) continue;
    const key = `${normalized.anchorType}\0${normalized.anchorValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function uniqueAnchors<T extends { anchorType: string; anchorValue: string; source: string }>(
  anchors: T[],
): T[] {
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = `${anchor.anchorType}\0${anchor.anchorValue}\0${anchor.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function upsertEvidenceValues(
  db: DbOrTx,
  values: (typeof reconciliationEvidence.$inferInsert)[],
): Promise<void> {
  if (values.length === 0) return;
  await db
    .insert(reconciliationEvidence)
    .values(values)
    .onConflictDoUpdate({
      target: [reconciliationEvidence.teamId, reconciliationEvidence.dedupeKey],
      set: {
        sourcePayloadRef: sql`excluded.source_payload_ref`,
        payloadDigest: sql`excluded.payload_digest`,
        source: sql`excluded.source`,
        provider: sql`excluded.provider`,
        externalObjectId: sql`excluded.external_object_id`,
        externalEventId: sql`excluded.external_event_id`,
        eventType: sql`excluded.event_type`,
        occurredAt: sql`excluded.occurred_at`,
        visibility: sql`excluded.visibility`,
        visibilityOwnerUserId: sql`excluded.visibility_owner_user_id`,
        visibilityUserIds: sql`excluded.visibility_user_ids`,
        actor: sql`excluded.actor`,
        contentDigest: sql`excluded.content_digest`,
        title: sql`excluded.title`,
        summary: sql`excluded.summary`,
        sourceUrl: sql`excluded.source_url`,
        metadata: sql`excluded.metadata`,
        normalizerVersion: sql`excluded.normalizer_version`,
        replayState: sql`excluded.replay_state`,
      },
    });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
