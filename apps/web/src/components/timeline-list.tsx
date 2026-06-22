'use client';

import { truncateFilenameMiddle } from '@timeline/shared/documents/presentation';
import { ExternalLink, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import type { TimelineCapturedFile } from '@/lib/timeline-captured-files';
import type { TimelineEvent } from '@/lib/use-paginated-queries';

import { removeConversationalEventAction } from '@/app/actions/events';
import { DocumentPreview } from '@/components/documents/document-preview';
import { EmptyAction } from '@/components/empty-action';
import { EventVisibilityForm } from '@/components/event-visibility-form';
import { useInspector } from '@/components/inspector-context';
import { Button } from '@/components/ui/button';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import {
  buildTimelineMoments,
  actorLabelsByTelegramUserId,
  filterTimelineMomentsByImpact,
  meetingDetailHrefForMoment,
  displayMeta,
  telegramUsernameLabel,
  type ImpactItem,
  type TimelineImpactFilter,
  type TimelineMoment,
} from '@/lib/timeline-moments';
import { cn } from '@/lib/utils';

interface Props {
  events: TimelineEvent[];
  authorMap: Map<string, { id: string; name: string | null; email: string }>;
  /** Signed GET URLs keyed by event id. Missing entries render the player disabled. */
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members?: { id: string; label: string }[];
  compact?: boolean;
  maxMoments?: number;
  emptyLabel?: string;
  emptyAction?: { href: string; label: string; body: string };
  impactFilter?: TimelineImpactFilter;
  impactItemsByEventId?: Record<string, ImpactItem[]>;
  capturedFilesByEventId?: Record<string, TimelineCapturedFile[]>;
  focusEventId?: string | null;
  timezone?: string;
}

const EMPTY_MEMBERS: NonNullable<Props['members']> = [];
const EMPTY_CAPTURED_FILES_BY_EVENT_ID: NonNullable<Props['capturedFilesByEventId']> = {};

const IMPACT_LABEL: Record<ImpactItem['kind'], string> = {
  task: 'Task',
  board: 'Board',
  object: 'Object',
  calendar: 'Calendar',
  document: 'Document',
  decision: 'Decision',
  approval: 'Approval',
};

const INSPECTOR_RAW_EVENT_LIMIT = 8;

function eventDate(input: Date | string): Date {
  if (input instanceof Date) return input;
  return new Date(input);
}

function formatTimestamp(input: string, timezone?: string): string {
  return formatDisplayDateTime(eventDate(input), { timezone });
}

function formatMetadataValue(value: unknown, timezone?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return displayText(value, { timezone });
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function metaObject(meta: unknown): Record<string, unknown> {
  return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
}

function stringMeta(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function positiveIntegerMeta(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function friendlyMeta(
  meta: Record<string, unknown>,
  key: string,
  timezone?: string,
): string | null {
  const value = formatMetadataValue(meta[key], timezone).trim();
  return value.length > 0 ? value : null;
}

function formatVisibilitySummary(events: TimelineEvent[]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.visibility, (counts.get(event.visibility) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([visibility, count]) =>
      count === events.length ? visibility : `${visibility} x ${count}`,
    )
    .join(' · ');
}

function uniqueLabels(labels: (string | null | undefined)[]): string[] {
  return [...new Set(labels.filter((label): label is string => Boolean(label)))];
}

function inspectorTitle(moment: TimelineMoment): string {
  const contexts = uniqueLabels(moment.rawEvents.map(rawEventContextLabel));
  const context = contexts[0];
  if (context) return `${moment.sourceLabel} · ${context}`;
  return moment.sourceLabel;
}

function sourceTruthSummary(moment: TimelineMoment): { title: string; body: string | null } {
  const actorByTelegramUserId = actorLabelsByTelegramUserId(moment.rawEvents);
  const actors = uniqueLabels(
    moment.rawEvents.map((event) => rawEventActorLabel(event, actorByTelegramUserId)),
  );
  const contexts = uniqueLabels(moment.rawEvents.map(rawEventContextLabel));
  const parts = [
    moment.rawEvents.length === 1
      ? '1 source event'
      : `${String(moment.rawEvents.length)} source events`,
    contexts.length === 1
      ? contexts[0]
      : contexts.length > 1
        ? `${String(contexts.length)} places`
        : null,
    actors.length === 1 ? actors[0] : actors.length > 1 ? `${String(actors.length)} senders` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    title: inspectorTitle(moment),
    body: parts.length > 0 ? parts.join(' · ') : null,
  };
}

function rawEventBody(event: TimelineEvent, timezone?: string): string {
  const meta = metaObject(event.sourceMetadata);
  const content = event.contentText?.trim();
  if (content) return displayText(truncateAttachedFilenameText(content), { timezone });
  const caption = stringMeta(meta, 'tg_caption');
  if (caption) return displayText(caption, { timezone });
  const transcriptionStatus = transcriptionStatusMessage(event);
  if (transcriptionStatus) return transcriptionStatus;
  return 'Source event captured.';
}

function truncateAttachedFilenameText(text: string): string {
  const match = /^(Attached (?:image|file) )(.+)$/i.exec(text.trim());
  if (!match) return text;
  return `${match[1] ?? ''}${truncateFilenameMiddle(match[2] ?? '')}`;
}

function truncateNullableFilename(value: string | null): string | null {
  return value ? truncateFilenameMiddle(value) : null;
}

function addDetail(
  entries: [string, string][],
  seen: Set<string>,
  label: string,
  value: string | null,
  timezone?: string,
) {
  if (!value || seen.has(label)) return;
  seen.add(label);
  entries.push([label, displayText(value, { timezone })]);
}

function inspectorSourceDetailEntries(
  moment: TimelineMoment,
  timezone?: string,
): [string, string][] {
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  const actorByTelegramUserId = actorLabelsByTelegramUserId(moment.rawEvents);
  for (const event of moment.rawEvents) {
    if (typeof event.sourceMetadata !== 'object' || event.sourceMetadata === null) continue;
    const meta = event.sourceMetadata as Record<string, unknown>;
    if (event.source === 'telegram') {
      addDetail(
        entries,
        seen,
        'Sender',
        rawEventActorLabel(event, actorByTelegramUserId),
        timezone,
      );
      addDetail(entries, seen, 'Chat', stringMeta(meta, 'tg_chat_title'), timezone);
      addDetail(entries, seen, 'Chat type', stringMeta(meta, 'tg_chat_type'), timezone);
      addDetail(entries, seen, 'Caption', stringMeta(meta, 'tg_caption'), timezone);
    } else if (event.source === 'slack') {
      addDetail(entries, seen, 'Sender', stringMeta(meta, 'slack_sender_name'), timezone);
      addDetail(entries, seen, 'Channel', stringMeta(meta, 'slack_channel_name'), timezone);
    } else if (event.source === 'email') {
      addDetail(entries, seen, 'Subject', stringMeta(meta, 'subject'), timezone);
      addDetail(
        entries,
        seen,
        'From',
        formatMetadataValue(meta.from, timezone).trim() || null,
        timezone,
      );
    } else if (event.source === 'document') {
      addDetail(
        entries,
        seen,
        'Document',
        truncateNullableFilename(stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name')),
        timezone,
      );
      addDetail(entries, seen, 'Origin', stringMeta(meta, 'source'), timezone);
    } else if (event.source === 'meeting' || event.source === 'calendar') {
      addDetail(entries, seen, 'Title', stringMeta(meta, 'title'), timezone);
    } else if (event.source === 'integration') {
      addDetail(entries, seen, 'Provider', stringMeta(meta, 'provider'), timezone);
      addDetail(entries, seen, 'Event', stringMeta(meta, 'event_type'), timezone);
      addDetail(entries, seen, 'Actor', friendlyMeta(meta, 'actor', timezone), timezone);
    } else if (event.source === 'ingest_webhook') {
      addDetail(entries, seen, 'Webhook', stringMeta(meta, 'ingest_webhook_name'), timezone);
      addDetail(entries, seen, 'Content type', stringMeta(meta, 'content_type'), timezone);
    }
  }
  return entries;
}

function transcribeFailed(meta: unknown): boolean {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    typeof (meta as Record<string, unknown>).transcription_failed_at === 'string'
  );
}

function transcribed(meta: unknown): boolean {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    typeof (meta as Record<string, unknown>).transcribed_at === 'string'
  );
}

function transcriptionStatusMessage(event: TimelineEvent): string | null {
  if (!event.contentAudioUrl || transcribed(event.sourceMetadata)) return null;
  return transcribeFailed(event.sourceMetadata)
    ? 'Transcription failed; voice memo is still playable.'
    : 'Transcribing...';
}

function canRemoveConversational(
  event: TimelineEvent,
  currentUserId: string,
  isAdmin: boolean,
): boolean {
  return (
    (event.source === 'telegram' || event.source === 'slack') &&
    (isAdmin || event.authorUserId === currentUserId)
  );
}

function canEditVisibility(event: TimelineEvent, currentUserId: string): boolean {
  return event.visibilityOwnerUserId === currentUserId;
}

function rawEventActorLabel(
  event: TimelineEvent,
  actorByTelegramUserId = new Map<string, string>(),
): string {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'telegram') {
    const userId = displayMeta(meta, 'tg_user_id');
    return (
      stringMeta(meta, 'tg_sender_name') ??
      telegramUsernameLabel(meta) ??
      (userId ? actorByTelegramUserId.get(userId) : null) ??
      'Telegram sender'
    );
  }
  if (event.source === 'slack') {
    return stringMeta(meta, 'slack_sender_name') ?? 'Slack sender';
  }
  if (event.source === 'document') {
    const source = stringMeta(meta, 'source');
    return source ? `${source} attachment` : 'Document';
  }
  if (event.source === 'ingest_webhook') {
    return stringMeta(meta, 'ingest_webhook_name') ?? 'Ingest webhook';
  }
  return event.source;
}

function rawEventContextLabel(event: TimelineEvent): string | null {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'telegram') {
    const label = stringMeta(meta, 'tg_chat_title') ?? stringMeta(meta, 'tg_chat_type');
    return label ? displayText(label) : null;
  }
  if (event.source === 'slack') {
    const label = stringMeta(meta, 'slack_channel_name') ?? stringMeta(meta, 'slack_channel_id');
    return label ? displayText(label) : null;
  }
  if (event.source === 'document') {
    const label = stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name');
    return label ? displayText(truncateFilenameMiddle(label)) : null;
  }
  if (event.source === 'ingest_webhook') {
    const label = stringMeta(meta, 'ingest_webhook_name');
    return label ? displayText(label) : null;
  }
  return null;
}

function rawEventDocumentLink(event: TimelineEvent): {
  href: string;
  label: string;
  title: string;
  documentId: string;
  versionId: string | null;
  versionNumber: number | null;
  canPreview: boolean;
} | null {
  const meta = metaObject(event.sourceMetadata);
  const documentId = stringMeta(meta, 'document_id') ?? stringMeta(meta, 'documentId');
  if (!documentId) return null;
  const action = stringMeta(meta, 'action');
  const filename = stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name') ?? 'Attachment';
  return {
    href: `/app/documents/${documentId}`,
    label: displayText(truncateFilenameMiddle(filename)),
    title: displayText(filename),
    documentId,
    versionId: stringMeta(meta, 'document_version_id') ?? stringMeta(meta, 'documentVersionId'),
    versionNumber: positiveIntegerMeta(meta, 'document_version'),
    canPreview: action === 'upload' || action === 'new_version',
  };
}

function groupedByDate(moments: TimelineMoment[]): [string, TimelineMoment[]][] {
  const groups = new Map<string, TimelineMoment[]>();
  for (const moment of moments) {
    const existing = groups.get(moment.dateLabel);
    if (existing) existing.push(moment);
    else groups.set(moment.dateLabel, [moment]);
  }
  return [...groups.entries()];
}

function InspectorBody({
  moment,
  capturedFilesByEventId,
  timezone,
}: {
  moment: TimelineMoment;
  capturedFilesByEventId: Record<string, TimelineCapturedFile[]>;
  timezone?: string;
}) {
  const metadata = inspectorSourceDetailEntries(moment, timezone);
  const summary = sourceTruthSummary(moment);
  const visibleRawEvents = moment.rawEvents.slice(0, INSPECTOR_RAW_EVENT_LIMIT);
  const hiddenRawEventCount = moment.rawEvents.length - visibleRawEvents.length;
  const actorByTelegramUserId = actorLabelsByTelegramUserId(moment.rawEvents);

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
          Why this row exists
        </h3>
        <p className="break-words text-sm font-medium leading-6 text-fg">{moment.summary}</p>
        {summary.body ? (
          <p className="mt-1 break-words text-sm leading-6 text-fg-muted">
            Source truth · {summary.body}
          </p>
        ) : null}
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          Visibility · {formatVisibilitySummary(moment.rawEvents)}
        </p>
      </section>
      {moment.impactItems.length > 0 ? (
        <section>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
            Impact context
          </h3>
          <ul className="space-y-1.5">
            {moment.impactItems.map((item, index) => (
              <li
                key={`${item.kind}:${item.label}:${index}`}
                className="rounded-sm border border-border bg-surface-2 px-2 py-1.5"
              >
                {item.href ? (
                  <Link href={item.href} className="break-words text-fg hover:text-signal">
                    {IMPACT_LABEL[item.kind]} · {item.label}
                  </Link>
                ) : (
                  <span className="break-words">
                    {IMPACT_LABEL[item.kind]} · {item.label}
                  </span>
                )}
                {item.status ? <span> · {item.status}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
          Source evidence
        </h3>
        <ol className="space-y-2">
          {visibleRawEvents.map((event) => (
            <SourceEvidenceCard
              key={event.id}
              event={event}
              actorLabel={rawEventActorLabel(event, actorByTelegramUserId)}
              capturedFiles={capturedFilesByEventId[event.id] ?? []}
              timezone={timezone}
            />
          ))}
        </ol>
        {hiddenRawEventCount > 0 ? (
          <p className="mt-2 rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-fg-dim">
            + {hiddenRawEventCount} older source{hiddenRawEventCount === 1 ? '' : 's'}
          </p>
        ) : null}
      </section>
      {metadata.length > 0 ? (
        <section>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
            Source details
          </h3>
          <dl className="space-y-1.5">
            {metadata.map(([key, value]) => (
              <div key={key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                <dt className="truncate text-fg-dim">{key}</dt>
                <dd className="min-w-0 truncate text-fg-muted" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function SourceEvidenceCard({
  event,
  actorLabel,
  capturedFiles,
  timezone,
}: {
  event: TimelineEvent;
  actorLabel: string;
  capturedFiles: TimelineCapturedFile[];
  timezone?: string;
}) {
  const documentLink = rawEventDocumentLink(event);
  const context = rawEventContextLabel(event);
  const transcriptionStatus = transcriptionStatusMessage(event);
  const body = rawEventBody(event, timezone);
  return (
    <li className="min-w-0 overflow-hidden rounded-sm border border-border bg-bg px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
        <span className="text-fg-muted">{actorLabel}</span>
        <span>{event.source}</span>
        {context ? <span>{context}</span> : null}
        <time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt, timezone)}</time>
        {event.visibility === 'private' ? <span>Private</span> : null}
      </div>
      {documentLink ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-start gap-2">
          <Link
            href={documentLink.href}
            title={documentLink.title}
            className="inline-flex min-h-7 max-w-full min-w-0 items-center rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted transition-colors hover:text-signal"
          >
            <span className="min-w-0 truncate">Attachment · {documentLink.label}</span>
          </Link>
          {documentLink.canPreview ? (
            <DocumentPreview
              target={{
                documentId: documentLink.documentId,
                versionId: documentLink.versionId,
                versionNumber: documentLink.versionNumber,
              }}
              label="Preview"
              compact
              className="w-full sm:w-auto sm:min-w-72"
            />
          ) : null}
        </div>
      ) : null}
      {capturedFiles.length > 0 ? (
        <div className="mt-2 space-y-2">
          {capturedFiles.map((file) => (
            <CapturedFileEvidence key={file.id} file={file} />
          ))}
        </div>
      ) : null}
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-muted">
        {body}
      </p>
      {transcriptionStatus && body !== transcriptionStatus ? (
        <p className="mt-2 text-sm italic text-fg-dim">{transcriptionStatus}</p>
      ) : null}
    </li>
  );
}

function CapturedFileEvidence({ file }: { file: TimelineCapturedFile }) {
  const version = file.currentVersion;
  const contentType = version?.contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  const canPreview = Boolean(
    version?.id &&
    (contentType.startsWith('image/') ||
      contentType.startsWith('audio/') ||
      contentType === 'application/pdf'),
  );
  const displayTitle = file.presentation.displayTitle;
  const storedName =
    file.presentation.isGeneratedName && displayTitle !== file.name
      ? truncateFilenameMiddle(file.name)
      : null;
  return (
    <div className="min-w-0 rounded-sm border border-border bg-surface-2 p-2">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <Link
          href={`/app/documents/${file.id}`}
          title={file.name}
          className="inline-flex min-h-7 max-w-full min-w-0 items-center rounded-sm border border-border bg-bg px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted transition-colors hover:text-signal"
        >
          <span className="min-w-0 truncate">Attachment · {displayTitle}</span>
        </Link>
        {canPreview && version ? (
          <DocumentPreview
            target={{ documentId: file.id, versionId: version.id }}
            label="Preview"
            compact
            className="w-full sm:w-auto sm:min-w-72"
          />
        ) : null}
      </div>
      {storedName ? (
        <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
          Stored as <span title={file.name}>{storedName}</span>
        </p>
      ) : null}
    </div>
  );
}

function InspectorActions({
  moment,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members,
  timezone,
}: {
  moment: TimelineMoment;
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  timezone?: string;
}) {
  const editableEvents = moment.rawEvents.filter((event) =>
    canEditVisibility(event, currentUserId),
  );
  const removableEvents = moment.rawEvents.filter((event) =>
    canRemoveConversational(event, currentUserId, isAdmin),
  );
  const audioEvents = moment.rawEvents.filter((event) => event.contentAudioUrl);
  if (editableEvents.length === 0 && removableEvents.length === 0 && audioEvents.length === 0) {
    return null;
  }
  return (
    <section>
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
        Event controls
      </h3>
      <div className="space-y-3">
        {audioEvents.map((event) =>
          audioUrlMap?.get(event.id) ? (
            <audio
              key={event.id}
              src={audioUrlMap.get(event.id)}
              controls
              aria-label="Voice memo"
              preload="metadata"
              className="w-full"
            >
              <track kind="captions" src="data:text/vtt,WEBVTT" srcLang="en" label="Captions" />
            </audio>
          ) : (
            <p
              key={event.id}
              className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim"
            >
              [audio unavailable]
            </p>
          ),
        )}
        {editableEvents.map((event) => (
          <details key={event.id} className="text-xs">
            <summary className="cursor-pointer font-mono uppercase tracking-[0.1em] text-fg-dim">
              Visibility · {formatTimestamp(event.occurredAt, timezone)}
            </summary>
            <EventVisibilityForm
              eventId={event.id}
              visibility={event.visibility}
              visibilityUserIds={event.visibilityUserIds}
              members={members}
            />
          </details>
        ))}
        {removableEvents.map((event) => (
          <form key={event.id} action={removeConversationalEventAction}>
            <input type="hidden" name="id" value={event.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-fg-dim hover:text-danger"
              title="Remove from timeline"
            >
              <Trash2 aria-hidden="true" className="mr-1.5 size-3.5" />
              Remove {formatTimestamp(event.occurredAt, timezone)}
            </Button>
          </form>
        ))}
      </div>
    </section>
  );
}

function ImpactStrip({ items, timezone }: { items: ImpactItem[]; timezone?: string }) {
  if (items.length === 0) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap justify-start gap-x-2 gap-y-1 md:justify-end"
      aria-label="Impact context"
    >
      {items.slice(0, 2).map((item, index) => {
        const count = item.count && item.count > 1 ? ` ×${item.count}` : '';
        const status = item.status ? ` · ${item.status}` : '';
        const label = displayText(`${IMPACT_LABEL[item.kind]} · ${item.label}${count}${status}`, {
          timezone,
        });
        const className =
          'inline-flex min-h-6 max-w-full min-w-0 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim transition-colors hover:text-fg';
        return item.href ? (
          <Link key={`${item.kind}:${item.label}:${index}`} href={item.href} className={className}>
            <span className="min-w-0 truncate">{label}</span>
          </Link>
        ) : (
          <span key={`${item.kind}:${item.label}:${index}`} className={className}>
            <span className="min-w-0 truncate">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function momentTranscriptionStatus(moment: TimelineMoment): string | null {
  for (const event of moment.rawEvents) {
    const status = transcriptionStatusMessage(event);
    if (status) return status;
  }
  return null;
}

function TimelineMomentRow({
  moment,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members,
  capturedFilesByEventId,
  compact,
  timezone,
}: {
  moment: TimelineMoment;
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  capturedFilesByEventId: Record<string, TimelineCapturedFile[]>;
  compact: boolean;
  timezone?: string;
}) {
  const inspector = useInspector();
  const selected = inspector.open && inspector.content?.id === moment.id;
  const meetingHref = meetingDetailHrefForMoment(moment);
  const transcriptionStatus = momentTranscriptionStatus(moment);
  return (
    <li
      className={cn(
        'relative -mx-3 grid scroll-mt-24 grid-cols-1 border-b border-border px-3 transition-colors hover:bg-surface md:grid-cols-[6.75rem_minmax(0,1fr)_minmax(10rem,34rem)]',
        selected && 'bg-surface shadow-[inset_2px_0_0_var(--signal)]',
      )}
    >
      {moment.rawEvents.map((event) => (
        <span
          key={event.id}
          id={`ev-${event.id}`}
          aria-hidden="true"
          className="absolute -top-16 left-0 size-px scroll-mt-24 overflow-hidden target:h-full target:w-0.5 target:bg-signal"
        />
      ))}
      <div className="relative px-0 pt-3 font-mono text-xs text-fg-dim md:px-0 md:py-3 md:pr-4">
        <span>{moment.timeLabel}</span>
        <span
          aria-hidden="true"
          className="absolute right-1 top-0 hidden h-full w-px bg-border md:block"
        />
        <span
          aria-hidden="true"
          className="absolute right-[-5px] top-4 hidden size-2.5 border border-border-strong bg-bg md:block"
        />
      </div>
      <div className="min-w-0 py-2 md:py-3 md:pl-4">
        <button
          type="button"
          onClick={() => {
            inspector.show({
              id: moment.id,
              kind: moment.sourceLabel.toUpperCase(),
              title: inspectorTitle(moment),
              render: () => (
                <div className="space-y-5">
                  <InspectorBody
                    moment={moment}
                    capturedFilesByEventId={capturedFilesByEventId}
                    timezone={timezone}
                  />
                  <InspectorActions
                    moment={moment}
                    audioUrlMap={audioUrlMap}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    members={members}
                    timezone={timezone}
                  />
                </div>
              ),
            });
          }}
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            <span className="text-fg">{moment.sourceLabel}</span>
            <span>{moment.actorLabel}</span>
            <span>{moment.contextLabel}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium leading-5 text-fg">{moment.summary}</p>
          <p
            className={cn(
              'mt-0.5 truncate text-sm leading-5 text-fg-muted',
              !compact && 'md:max-w-[72ch]',
            )}
          >
            {sourceTruthSummary(moment).body ?? 'Source evidence available'}
          </p>
        </button>
        {meetingHref ? (
          <Link
            href={meetingHref}
            className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:text-signal"
          >
            <ExternalLink aria-hidden="true" className="size-3" />
            Open transcript
          </Link>
        ) : null}
      </div>
      <div className="flex min-w-0 items-start justify-start gap-2 pb-3 md:justify-end md:py-3">
        <ImpactStrip items={moment.impactItems} timezone={timezone} />
        {transcriptionStatus ? (
          <span className="inline-flex min-h-6 max-w-full min-w-0 items-center rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
            {transcriptionStatus}
          </span>
        ) : null}
        <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
          {moment.rawEvents.length} source{moment.rawEvents.length === 1 ? '' : 's'}
        </span>
      </div>
    </li>
  );
}

export function TimelineList({
  events,
  authorMap,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members = EMPTY_MEMBERS,
  compact = false,
  maxMoments,
  emptyLabel = 'NO EVENTS YET',
  emptyAction,
  impactFilter = 'all',
  impactItemsByEventId,
  capturedFilesByEventId = EMPTY_CAPTURED_FILES_BY_EVENT_ID,
  focusEventId = null,
  timezone,
}: Props) {
  const moments = useMemo(
    () =>
      buildTimelineMoments(
        events,
        authorMap,
        impactItemsByEventId === undefined ? { timezone } : { impactItemsByEventId, timezone },
      ),
    [events, authorMap, impactItemsByEventId, timezone],
  );
  const focusedMoments =
    focusEventId === null
      ? []
      : moments.filter((moment) => moment.rawEvents.some((event) => event.id === focusEventId));
  const filteredMoments = mergeTimelineMoments(
    filterTimelineMomentsByImpact(moments, impactFilter),
    focusedMoments,
  );
  const visibleMoments =
    typeof maxMoments === 'number' ? filteredMoments.slice(0, maxMoments) : filteredMoments;
  const dateGroups = groupedByDate(visibleMoments);

  if (visibleMoments.length === 0) {
    if (emptyAction) {
      return (
        <EmptyAction
          title={emptyLabel}
          body={emptyAction.body}
          href={emptyAction.href}
          action={emptyAction.label}
        />
      );
    }

    return (
      <div className="border-y border-border py-10 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div aria-label={compact ? 'Recent timeline moments' : 'Timeline moments'}>
      {dateGroups.map(([date, group]) => (
        <section key={date} aria-labelledby={`timeline-date-${date}`}>
          <h2
            id={`timeline-date-${date}`}
            className="sticky top-0 z-10 -mx-3 border-y border-border bg-bg px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim"
          >
            {date}
          </h2>
          <ol>
            {group.map((moment) => (
              <TimelineMomentRow
                key={moment.id}
                moment={moment}
                audioUrlMap={audioUrlMap}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                members={members}
                capturedFilesByEventId={capturedFilesByEventId}
                compact={compact}
                timezone={timezone}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function mergeTimelineMoments(
  primary: TimelineMoment[],
  additional: TimelineMoment[],
): TimelineMoment[] {
  if (additional.length === 0) return primary;
  const seen = new Set<string>();
  return [...primary, ...additional]
    .filter((moment) => {
      if (seen.has(moment.id)) return false;
      seen.add(moment.id);
      return true;
    })
    .sort(
      (a, b) =>
        eventDate(b.rawEvents[0]?.occurredAt ?? new Date(0)).getTime() -
        eventDate(a.rawEvents[0]?.occurredAt ?? new Date(0)).getTime(),
    );
}
