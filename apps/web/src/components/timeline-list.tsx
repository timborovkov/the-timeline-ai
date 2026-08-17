'use client';

import { truncateFilenameMiddle } from '@timeline/shared/documents/presentation';
import { isMachineIdentityLabel } from '@timeline/shared/event-class';
import {
  Activity,
  CalendarDays,
  ExternalLink,
  FileText,
  GitPullRequest,
  Mail,
  MessageSquareText,
  Mic,
  NotebookText,
  Radio,
  Trash2,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Fragment,
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import type { TimelineCapturedFile } from '@/lib/timeline-captured-files';
import type { TimelineArtifactCluster, TimelineEvent } from '@/lib/use-paginated-queries';

import { removeConversationalEventAction } from '@/app/actions/events';
import { CitationCopyChip } from '@/components/artifact-reference-chip';
import { DocumentPreview } from '@/components/documents/document-preview';
import { EmptyAction } from '@/components/empty-action';
import { EventVisibilityForm, type SavedEventVisibility } from '@/components/event-visibility-form';
import { useInspector } from '@/components/inspector-context';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { SourceOriginalDisclosure } from '@/components/source-original';
import { TechnicalDetails } from '@/components/technical-details';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { statusLabel } from '@/lib/status-labels';
import {
  buildTimelineMoments,
  actorLabelsByTelegramUserId,
  filterTimelineMomentsByImpact,
  meetingDetailHrefForMoment,
  displayMeta,
  telegramUsernameLabel,
  formatTimelineAttachmentText,
  timelineAttachmentSummaryFromMetadata,
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
  serverMoments?: TimelineMoment[];
  pinnedMomentIds?: ReadonlySet<string>;
  emptyLabel?: string;
  emptyAction?: { href: string; label: string; body: string };
  impactFilter?: TimelineImpactFilter;
  impactItemsByEventId?: Record<string, ImpactItem[]>;
  artifactClustersByEventId?: Record<string, TimelineArtifactCluster>;
  capturedFilesByEventId?: Record<string, TimelineCapturedFile[]>;
  focusEventId?: string | null;
  focusMomentId?: string | null;
  timezone?: string;
  mode?: 'moments' | 'events';
}

const EMPTY_MEMBERS: NonNullable<Props['members']> = [];
const EMPTY_ARTIFACT_CLUSTERS_BY_EVENT_ID: NonNullable<Props['artifactClustersByEventId']> = {};
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
const SOURCE_EVIDENCE_BODY_CHARACTER_LIMIT = 420;
const SOURCE_EVIDENCE_BODY_LINE_LIMIT = 6;

const MOMENT_KIND_ICON: Record<TimelineMoment['kind'], LucideIcon> = {
  conversation: MessageSquareText,
  meeting: Mic,
  email_thread: Mail,
  calendar: CalendarDays,
  document: FileText,
  code_review: GitPullRequest,
  ci_deploy: Activity,
  incident: Radio,
  integration_activity: Activity,
  webhook: Webhook,
  system: Activity,
  note: NotebookText,
};

function eventDate(input: Date | string): Date {
  if (input instanceof Date) return input;
  return new Date(input);
}

function formatTimestamp(input: string, timezone: string): string {
  return formatDisplayDateTime(eventDate(input), { timezone });
}

function formatMetadataValue(value: unknown, timezone: string): string {
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

function friendlyMeta(meta: Record<string, unknown>, key: string, timezone: string): string | null {
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

function formatSourceLabel(value: string): string {
  return titleCase(value);
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isRepeatedContext(value: string, ...primary: (string | null | undefined)[]): boolean {
  const normalized = normalizedText(value);
  if (!normalized) return true;
  return primary.some((item) => {
    const candidate = normalizedText(item);
    return ` ${candidate} `.includes(` ${normalized} `);
  });
}

function displayMomentTitle(moment: TimelineMoment): string {
  const audioNote = moment.rawEvents
    .map((event) => stringMeta(metaObject(event.sourceMetadata), 'audio_note_text'))
    .find(Boolean);
  return audioNote ?? moment.title;
}

function supportingText(moment: TimelineMoment, fallback: string): string {
  const preview = moment.preview?.trim();
  const title = displayMomentTitle(moment);
  if (!preview) return fallback;
  if (normalizedText(preview) === normalizedText(title)) return fallback;
  if (preview.toLowerCase().startsWith(title.toLowerCase())) {
    const remainder = preview
      .slice(title.length)
      .replace(/^[\s.:;—–-]+/, '')
      .trim();
    if (remainder) return remainder;
  }
  return preview;
}

function humanizeImpact(item: ImpactItem): string {
  const parts = item.label.split('·').flatMap((part) => {
    const trimmed = part.trim();
    return trimmed ? [trimmed] : [];
  });
  const operation = parts.at(-1)?.toLowerCase();
  if (operation === 'create' || operation === 'created') {
    const target = (parts.at(-2) ?? item.kind).replaceAll('_', ' ').toLowerCase();
    return `Created ${target}`;
  }
  if (operation === 'update' || operation === 'updated') {
    const target = (parts.at(-2) ?? item.kind).replaceAll('_', ' ').toLowerCase();
    return `Updated ${target}`;
  }
  return `${IMPACT_LABEL[item.kind]} · ${item.label}`;
}

function eventCitationRef(eventId: string): { kind: 'timeline_event'; id: string } {
  return { kind: 'timeline_event', id: eventId };
}

function groupingCue(moment: TimelineMoment): string | null {
  const count = moment.rawEvents.length;
  if (count < 2) return null;
  if (moment.eventClass === 'communication') return `${count} messages`;
  if (moment.kind === 'ci_deploy') return `${count} runs`;
  return `${count} events`;
}

function rowContextParts(moment: TimelineMoment): string[] {
  const title = displayMomentTitle(moment);
  return [
    isRepeatedContext(moment.sourceLabel, title) ? null : moment.sourceLabel,
    isRepeatedContext(moment.actorLabel, moment.sourceLabel, title) ? null : moment.actorLabel,
    isRepeatedContext(moment.contextLabel, moment.sourceLabel, title, moment.actorLabel)
      ? null
      : moment.contextLabel,
    groupingCue(moment),
  ].filter((part): part is string => Boolean(part));
}

function workspaceImpactItems(moment: TimelineMoment): ImpactItem[] {
  const title = displayMomentTitle(moment);
  return moment.impactItems.filter((item) => {
    if (isMachineIdentityLabel(item.label)) return false;
    if (isRepeatedContext(item.label, title)) return false;
    if (item.kind === 'object' && moment.visualWeight === 'pulse') return false;
    return item.kind !== 'object' || Boolean(item.href);
  });
}

function humanClusters(moment: TimelineMoment): TimelineArtifactCluster[] {
  return moment.artifactClusters.filter(
    (cluster) => cluster.canonicalName && !isMachineIdentityLabel(cluster.canonicalName),
  );
}

function externalSourceHref(moment: TimelineMoment): string | null {
  for (const event of moment.rawEvents) {
    const meta = metaObject(event.sourceMetadata);
    const github = metaObject(meta.github);
    const url =
      stringMeta(meta, 'external_url') ?? stringMeta(github, 'url') ?? stringMeta(meta, 'url');
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

function inspectorFacts(moment: TimelineMoment, timezone: string): [string, string][] {
  const lead = moment.rawEvents[0];
  if (!lead) return [];
  const meta = metaObject(lead.sourceMetadata);
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  addDetail(
    entries,
    seen,
    'Repository',
    firstMetaString(meta, ['repo', 'repository', 'project']),
    timezone,
  );
  addDetail(
    entries,
    seen,
    'Branch',
    firstMetaString(meta, ['head_branch', 'branch', 'ref']),
    timezone,
  );
  addDetail(
    entries,
    seen,
    'Status',
    firstMetaString(meta, ['conclusion', 'status', 'state']),
    timezone,
  );
  addDetail(entries, seen, 'Event', firstMetaString(meta, ['event_type', 'event']), timezone);
  addDetail(entries, seen, 'Webhook', stringMeta(meta, 'ingest_webhook_name'), timezone);
  return entries.filter(([, value]) => !isRepeatedContext(value, displayMomentTitle(moment)));
}

function firstMetaString(meta: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = stringMeta(meta, key);
    if (direct) return direct;
  }
  for (const value of Object.values(meta)) {
    const nested = metaObject(value);
    for (const key of keys) {
      const nestedVal = stringMeta(nested, key);
      if (nestedVal) return nestedVal;
    }
  }
  return null;
}

function evidenceSourceLabel(evidence: TimelineArtifactCluster['relatedEvidence'][number]): string {
  return evidence.provider ?? evidence.source ?? 'source';
}

function evidenceStrengthLabel(
  evidence: TimelineArtifactCluster['relatedEvidence'][number],
): string {
  if (evidence.authoritative) return 'status source';
  return titleCase(evidence.strength);
}

function evidenceCountLabel(count: number): string {
  return `${count} signal${count === 1 ? '' : 's'}`;
}

function shouldCapSourceEvidenceBody(body: string): boolean {
  if (body.length > SOURCE_EVIDENCE_BODY_CHARACTER_LIMIT) return true;
  return body.split(/\r\n|\r|\n/).length > SOURCE_EVIDENCE_BODY_LINE_LIMIT;
}

function inspectorTitle(moment: TimelineMoment): string {
  return displayMomentTitle(moment);
}

function rawEventBody(event: TimelineEvent, timezone: string): string {
  const meta = metaObject(event.sourceMetadata);
  const content = event.contentText?.trim();
  if (content) return displayText(formatTimelineAttachmentText(content), { timezone });
  const caption = stringMeta(meta, 'tg_caption');
  if (caption) return displayText(caption, { timezone });
  const attachmentSummary = timelineAttachmentSummaryFromMetadata(meta);
  if (attachmentSummary) return displayText(attachmentSummary, { timezone });
  const transcriptionStatus = transcriptionStatusMessage(event);
  if (transcriptionStatus) return transcriptionStatus;
  return 'Source event captured.';
}

function truncateNullableFilename(value: string | null): string | null {
  return value ? truncateFilenameMiddle(value) : null;
}

function addDetail(
  entries: [string, string][],
  seen: Set<string>,
  label: string,
  value: string | null,
  timezone: string,
) {
  if (!value || seen.has(label)) return;
  seen.add(label);
  entries.push([label, displayText(value, { timezone })]);
}

function inspectorSourceDetailEntries(
  moment: TimelineMoment,
  timezone: string,
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
    : 'Transcribing…';
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
    const label = stringMeta(meta, 'slack_channel_name');
    return label ? displayText(label) : 'Unnamed channel';
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
  audioUrlMap,
  currentUserId,
  isAdmin,
  members,
  capturedFilesByEventId,
  timezone,
}: {
  moment: TimelineMoment;
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  capturedFilesByEventId: Record<string, TimelineCapturedFile[]>;
  timezone: string;
}) {
  const [visibleRawEventCount, setVisibleRawEventCount] = useState(INSPECTOR_RAW_EVENT_LIMIT);
  const visibleRawEvents = moment.rawEvents.slice(0, visibleRawEventCount);
  const hiddenRawEventCount = moment.rawEvents.length - visibleRawEvents.length;
  const actorByTelegramUserId = actorLabelsByTelegramUserId(moment.rawEvents);
  const impactItems = workspaceImpactItems(moment);
  const clusters = humanClusters(moment);
  const facts = inspectorFacts(moment, timezone);
  const href = externalSourceHref(moment);
  const meetingHref = meetingDetailHrefForMoment(moment);
  const preview = supportingText(moment, '');
  const compactEvidence = moment.visualWeight === 'pulse';

  return (
    <div className="space-y-5">
      {preview && preview !== displayMomentTitle(moment) ? (
        <p className="break-words text-sm leading-6 text-fg-muted">{preview}</p>
      ) : null}
      {facts.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-fg-dim">{label}</dt>
              <dd className="min-w-0 break-words text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {href || meetingHref ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-fg-muted underline decoration-border underline-offset-4 transition-colors hover:text-signal hover:decoration-signal"
            >
              Open source
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ) : null}
          {meetingHref ? (
            <Link
              href={meetingHref}
              className="inline-flex items-center text-sm text-fg-muted underline decoration-border underline-offset-4 transition-colors hover:text-signal hover:decoration-signal"
            >
              Open transcript
            </Link>
          ) : null}
        </div>
      ) : null}
      {impactItems.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Impact</h3>
          <ul className="space-y-1.5">
            {impactItems.map((item, index) => (
              <li
                key={`${item.kind}:${item.label}:${index}`}
                className="rounded-sm border border-border bg-surface-2 px-2 py-1.5"
              >
                {item.href ? (
                  <Link
                    href={item.href}
                    className="inline-flex max-w-full items-center gap-1 break-words text-fg underline decoration-border underline-offset-4 transition-colors hover:text-signal hover:decoration-signal"
                  >
                    <span className="min-w-0 break-words">{humanizeImpact(item)}</span>
                    <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                  </Link>
                ) : (
                  <span className="break-words">{humanizeImpact(item)}</span>
                )}
                {item.status ? <span> · {statusLabel(item.status)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">
          {compactEvidence ? 'Activity' : 'Source evidence'}
        </h3>
        {compactEvidence ? (
          <ol className="space-y-2">
            {visibleRawEvents.map((event) => (
              <li key={event.id} className="min-w-0">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <time
                    dateTime={event.occurredAt}
                    className="shrink-0 font-mono text-xs text-fg-dim"
                  >
                    {formatTimestamp(event.occurredAt, timezone)}
                  </time>
                  <span className="min-w-0 truncate text-fg-muted">
                    {rawEventBody(event, timezone)}
                  </span>
                  <CitationCopyChip refValue={eventCitationRef(event.id)} className="shrink-0" />
                </div>
                <SourceOriginalDisclosure
                  source={event.source}
                  contentText={event.contentText}
                  sourceMetadata={event.sourceMetadata}
                  className="mt-2"
                />
              </li>
            ))}
          </ol>
        ) : (
          <ol className="space-y-2">
            {visibleRawEvents.map((event) => (
              <SourceEvidenceCard
                key={event.id}
                event={event}
                actorLabel={rawEventActorLabel(event, actorByTelegramUserId)}
                audioUrl={audioUrlMap?.get(event.id)}
                canEditVisibility={canEditVisibility(event, currentUserId)}
                canRemove={canRemoveConversational(event, currentUserId, isAdmin)}
                members={members}
                capturedFiles={capturedFilesByEventId[event.id] ?? []}
                timezone={timezone}
              />
            ))}
          </ol>
        )}
        {hiddenRawEventCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-8"
            onClick={() => {
              setVisibleRawEventCount((count) => count + INSPECTOR_RAW_EVENT_LIMIT);
            }}
          >
            Show {hiddenRawEventCount} older evidence item
            {hiddenRawEventCount === 1 ? '' : 's'}
          </Button>
        ) : null}
      </section>
      {clusters.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Related evidence</h3>
          <div className="space-y-3">
            {clusters.map((cluster) => (
              <ArtifactEvidenceBundle key={cluster.id} cluster={cluster} timezone={timezone} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function InspectorTechnicalDetails({
  moment,
  timezone,
}: {
  moment: TimelineMoment;
  timezone: string;
}) {
  const metadata = inspectorSourceDetailEntries(moment, timezone);
  const evidenceIds = moment.rawEvents.map((event) => event.id).join(', ');
  return (
    <TechnicalDetails
      items={[
        { label: 'Moment ID', value: moment.id, copyValue: moment.id },
        { label: 'Event class', value: moment.eventClass },
        { label: 'Evidence IDs', value: evidenceIds, copyValue: evidenceIds },
        { label: 'Visibility', value: formatVisibilitySummary(moment.rawEvents) },
        ...metadata.map(([label, value]) => ({ label, value, copyValue: value })),
      ]}
    />
  );
}

function ArtifactEvidenceBundle({
  cluster,
  timezone,
}: {
  cluster: TimelineArtifactCluster;
  timezone: string;
}) {
  const statusSources = cluster.relatedEvidence.filter((evidence) => evidence.authoritative).length;
  return (
    <div className="rounded-sm border border-border bg-surface p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium leading-5 text-fg">
            {cluster.canonicalName}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            {titleCase(cluster.artifactType)} · {titleCase(cluster.status)} ·{' '}
            {evidenceCountLabel(cluster.relatedEvidence.length)}
          </p>
        </div>
        {statusSources > 0 ? (
          <span className="shrink-0 rounded-sm border border-signal/30 bg-signal-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-signal">
            {statusSources} status source{statusSources === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      <ol className="mt-3 space-y-2">
        {cluster.relatedEvidence.map((evidence, index) => {
          const label = `${titleCase(evidenceSourceLabel(evidence))} · ${titleCase(evidence.role)}`;
          const body =
            evidence.snippet ??
            (evidence.externalObjectId ? `External reference ${evidence.externalObjectId}` : null);
          return (
            <li
              key={`${cluster.id}:${evidence.rawEventId ?? evidence.externalObjectId ?? index}`}
              className="rounded-sm border border-border bg-bg px-2.5 py-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                {evidence.rawEventId ? (
                  <Link
                    href={`/app/timeline?event=${evidence.rawEventId}#ev-${evidence.rawEventId}`}
                    className="text-fg-muted transition-colors hover:text-signal"
                  >
                    {label}
                  </Link>
                ) : (
                  <span className="text-fg-muted">{label}</span>
                )}
                <span>{evidenceStrengthLabel(evidence)}</span>
                {evidence.occurredAt ? (
                  <time data-visual-dynamic="timeline-timestamp" dateTime={evidence.occurredAt}>
                    {formatTimestamp(evidence.occurredAt, timezone)}
                  </time>
                ) : null}
              </div>
              {body ? (
                <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-fg-muted">
                  {displayText(body, { timezone })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SourceEvidenceCard({
  event,
  actorLabel,
  audioUrl,
  canEditVisibility: visibilityEditable,
  canRemove,
  members,
  capturedFiles,
  timezone,
}: {
  event: TimelineEvent;
  actorLabel: string;
  audioUrl?: string;
  canEditVisibility: boolean;
  canRemove: boolean;
  members: { id: string; label: string }[];
  capturedFiles: TimelineCapturedFile[];
  timezone: string;
}) {
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [savedVisibility, setSavedVisibility] = useState<SavedEventVisibility>({
    visibility: event.visibility,
    visibilityUserIds: event.visibilityUserIds ?? [],
  });
  const documentLink = rawEventDocumentLink(event);
  const context = rawEventContextLabel(event);
  const transcriptionStatus = transcriptionStatusMessage(event);
  const body = rawEventBody(event, timezone);
  const capBody = shouldCapSourceEvidenceBody(body);
  const metaLine = [
    actorLabel,
    formatSourceLabel(event.source),
    context,
    formatTimestamp(event.occurredAt, timezone),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
  return (
    <li className="min-w-0 overflow-hidden rounded-sm border border-border bg-bg px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
          <span className="text-fg-muted">{actorLabel}</span>
          <span>{formatSourceLabel(event.source)}</span>
          {context ? <span>{context}</span> : null}
          <time
            data-visual-dynamic="timeline-timestamp"
            dateTime={event.occurredAt}
            className="inline-block min-w-[28ch] whitespace-nowrap"
          >
            {formatTimestamp(event.occurredAt, timezone)}
          </time>
          {event.visibility === 'private' ? <span>Private</span> : null}
        </div>
        <CitationCopyChip refValue={eventCitationRef(event.id)} />
      </div>
      {documentLink ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-start gap-2">
          <Link
            href={documentLink.href}
            title={documentLink.title}
            className="inline-flex min-h-7 max-w-full min-w-0 items-center rounded-sm border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:text-signal"
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
      <p
        className={cn(
          'mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-muted',
          capBody ? 'max-h-32 overflow-hidden' : null,
        )}
      >
        {body}
      </p>
      {capBody ? (
        <>
          <button
            type="button"
            onClick={() => {
              setQuickViewOpen(true);
            }}
            className="mt-2 inline-flex min-h-7 items-center rounded-sm border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/30"
          >
            View full evidence
          </button>
          <Dialog open={quickViewOpen} onOpenChange={setQuickViewOpen}>
            <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] overflow-y-auto border-border bg-bg sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Source evidence</DialogTitle>
                <DialogDescription>{metaLine}</DialogDescription>
              </DialogHeader>
              <pre className="max-h-[min(520px,calc(100vh-14rem))] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface p-3 font-sans text-sm leading-6 text-fg-muted">
                {body}
              </pre>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
      <SourceOriginalDisclosure
        source={event.source}
        contentText={event.contentText}
        sourceMetadata={event.sourceMetadata}
        className="mt-3"
      />
      {transcriptionStatus && body !== transcriptionStatus ? (
        <p className="mt-2 text-sm italic text-fg-dim">{transcriptionStatus}</p>
      ) : null}
      <SourceEvidenceActions
        event={event}
        actorLabel={actorLabel}
        audioUrl={audioUrl}
        visibility={savedVisibility}
        canEditVisibility={visibilityEditable}
        canRemove={canRemove}
        members={members}
        onVisibilitySaved={setSavedVisibility}
        timezone={timezone}
      />
    </li>
  );
}

function visibilityLabel(value: SavedEventVisibility): string {
  if (value.visibility === 'private') return 'Private';
  if (value.visibility === 'specific_users') {
    return `Specific people · ${value.visibilityUserIds.length}`;
  }
  return 'Team visibility';
}

function evidenceTargetLabel(event: TimelineEvent, actorLabel: string, timezone: string): string {
  const firstLine = event.contentText?.split(/\r?\n/, 1)[0]?.trim();
  const subject = firstLine?.length ? firstLine : 'Evidence item';
  const compactSubject = subject.length > 60 ? `${subject.slice(0, 57)}…` : subject;
  return `${formatSourceLabel(event.source)} evidence “${compactSubject}” from ${actorLabel} at ${formatTimestamp(event.occurredAt, timezone)}`;
}

function SourceEvidenceActions({
  event,
  actorLabel,
  audioUrl,
  visibility,
  canEditVisibility: visibilityEditable,
  canRemove,
  members,
  onVisibilitySaved,
  timezone,
}: {
  event: TimelineEvent;
  actorLabel: string;
  audioUrl?: string;
  visibility: SavedEventVisibility;
  canEditVisibility: boolean;
  canRemove: boolean;
  members: { id: string; label: string }[];
  onVisibilitySaved: (value: SavedEventVisibility) => void;
  timezone: string;
}) {
  const targetLabel = evidenceTargetLabel(event, actorLabel, timezone);
  const hasActions = [Boolean(event.contentAudioUrl), visibilityEditable, canRemove].some(Boolean);
  if (!hasActions) return null;

  return (
    <ItemActionGroup
      placement="footer"
      label={`Actions for ${targetLabel}`}
      className="items-start sm:justify-start"
    >
      {event.contentAudioUrl ? (
        audioUrl ? (
          <audio
            src={audioUrl}
            controls
            aria-label={`Audio for ${targetLabel}`}
            preload="metadata"
            className="h-8 w-full basis-full"
          >
            <track kind="captions" src="data:text/vtt,WEBVTT" srcLang="en" label="Captions" />
          </audio>
        ) : (
          <p role="status" className="w-full basis-full text-xs text-fg-dim">
            Audio unavailable for this evidence item.
          </p>
        )
      ) : null}
      {visibilityEditable ? (
        <details className="min-w-0 basis-full text-xs">
          <summary className="w-fit cursor-pointer rounded-sm px-1 py-1.5 font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/30">
            {visibilityLabel(visibility)}
          </summary>
          <EventVisibilityForm
            eventId={event.id}
            visibility={visibility.visibility}
            visibilityUserIds={visibility.visibilityUserIds}
            members={members}
            onSaved={onVisibilitySaved}
          />
        </details>
      ) : null}
      {canRemove ? <EvidenceRemovalAction event={event} targetLabel={targetLabel} /> : null}
    </ItemActionGroup>
  );
}

function EvidenceRemovalAction({
  event,
  targetLabel,
}: {
  event: TimelineEvent;
  targetLabel: string;
}) {
  const [state, action, pending] = useActionState(removeConversationalEventAction, {});
  const dialog = useAppDialog();
  const inspector = useInspector();
  const router = useRouter();

  useEffect(() => {
    if (!state.ok) return;
    inspector.hide();
    router.refresh();
    toast.success('Evidence removed from Timeline');
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body || !active.isConnected) {
        document.querySelector<HTMLElement>('[data-inspector-focus-fallback]')?.focus();
      }
    }, 0);
  }, [inspector, router, state.ok]);

  const requestRemoval = () => {
    void dialog
      .confirm({
        title: 'Remove this evidence from Timeline?',
        description:
          'Timeline will tombstone this captured Telegram or Slack message and all stored revisions. This does not delete the message from Telegram or Slack, and derived summaries may update.',
        confirmLabel: 'Remove evidence',
        cancelLabel: 'Keep evidence',
        destructive: true,
      })
      .then((confirmed) => {
        if (!confirmed) return;
        const formData = new FormData();
        formData.set('id', event.id);
        startTransition(() => {
          action(formData);
        });
      });
  };

  return (
    <>
      <ItemOverflowMenu targetLabel={targetLabel}>
        <DropdownMenuItem
          disabled={pending}
          className="text-destructive focus:text-destructive"
          onSelect={requestRemoval}
        >
          <Trash2 aria-hidden="true" />
          {pending ? 'Removing evidence…' : 'Remove evidence'}
        </DropdownMenuItem>
      </ItemOverflowMenu>
      {state.error ? (
        <p role="alert" className="w-full basis-full text-xs text-destructive">
          {state.error} Open actions and try again.
        </p>
      ) : null}
      {dialog.node}
    </>
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
          className="inline-flex min-h-7 max-w-full min-w-0 items-center rounded-sm border border-border bg-bg px-2 py-1 text-xs text-fg-muted transition-colors hover:text-signal"
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

function momentTranscriptionStatus(moment: TimelineMoment): string | null {
  for (const event of moment.rawEvents) {
    const status = transcriptionStatusMessage(event);
    if (status) return status;
  }
  return null;
}

function momentInspectorContent({
  moment,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members,
  capturedFilesByEventId,
  timezone,
}: {
  moment: TimelineMoment;
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  capturedFilesByEventId: Record<string, TimelineCapturedFile[]>;
  timezone: string;
}) {
  return {
    id: moment.id,
    kind: moment.sourceLabel,
    title: inspectorTitle(moment),
    render: () => (
      <div className="space-y-5">
        <InspectorBody
          moment={moment}
          audioUrlMap={audioUrlMap}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          members={members}
          capturedFilesByEventId={capturedFilesByEventId}
          timezone={timezone}
        />
        <InspectorTechnicalDetails moment={moment} timezone={timezone} />
      </div>
    ),
  };
}

function TimelineMomentRow({
  moment,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members,
  capturedFilesByEventId,
  focused,
  compact,
  pinned,
  timezone,
}: {
  moment: TimelineMoment;
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  capturedFilesByEventId: Record<string, TimelineCapturedFile[]>;
  focused: boolean;
  compact: boolean;
  pinned: boolean;
  timezone: string;
}) {
  const inspector = useInspector();
  const selected = focused || (inspector.open && inspector.content?.id === moment.id);
  const meetingHref = meetingDetailHrefForMoment(moment);
  const transcriptionStatus = momentTranscriptionStatus(moment);
  const KindIcon = MOMENT_KIND_ICON[moment.kind];
  const title = displayMomentTitle(moment);
  const cue = groupingCue(moment);
  const pulse = moment.visualWeight === 'pulse';
  const previewText = supportingText(moment, '');
  const contextParts = rowContextParts(moment);
  const titleStem = title.replace(/…$/, '').trim().toLowerCase();
  const previewOverlapsTitle =
    Boolean(previewText) && Boolean(titleStem) && previewText.toLowerCase().startsWith(titleStem);
  const subtitleParts = [
    ...contextParts.filter((part) => !previewText.includes(part)),
    previewOverlapsTitle ? null : previewText,
  ].filter((part): part is string => Boolean(part));
  return (
    <li
      id={moment.anchorId}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group relative -mx-3 scroll-mt-24 border-b border-border/80 px-3 transition-colors hover:bg-surface',
        pulse ? 'min-h-11' : 'min-h-12',
        selected && 'bg-surface shadow-[inset_2px_0_0_var(--signal)]',
      )}
      data-moment-id={moment.id}
      data-visual-weight={moment.visualWeight}
      data-event-class={moment.eventClass}
    >
      {moment.rawEvents.map((event) => (
        <span
          key={event.id}
          id={`ev-${event.id}`}
          aria-hidden="true"
          className="absolute -top-16 left-0 size-px scroll-mt-24 overflow-hidden target:h-full target:w-0.5 target:bg-signal"
        />
      ))}
      <div
        className={cn(
          'grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 md:grid-cols-[4.5rem_1rem_minmax(0,1fr)]',
          pulse || compact ? 'py-2.5' : 'py-3',
        )}
      >
        <time
          data-visual-dynamic="timeline-time"
          className="pt-0.5 font-mono text-[11px] tabular-nums leading-5 text-fg-dim"
        >
          {moment.timeLabel}
        </time>
        <KindIcon
          aria-hidden="true"
          className="mt-0.5 hidden size-4 shrink-0 text-fg-dim md:block"
        />
        <div className="min-w-0 pr-8">
          <button
            type="button"
            aria-label={[title, previewText, moment.timeLabel, cue].filter(Boolean).join(' · ')}
            onClick={() => {
              inspector.show(
                momentInspectorContent({
                  moment,
                  audioUrlMap,
                  currentUserId,
                  isAdmin,
                  members,
                  capturedFilesByEventId,
                  timezone,
                }),
              );
            }}
            className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
          >
            <p
              className={cn(
                'truncate text-sm leading-5',
                pulse ? 'text-fg-muted' : 'font-medium text-fg',
              )}
            >
              {title}
            </p>
            {subtitleParts.length > 0 ? (
              <p className="mt-0.5 truncate text-xs leading-4 text-fg-dim">
                {subtitleParts.map((part, index) => (
                  <Fragment key={`${part}:${index}`}>
                    {index > 0 ? ' · ' : null}
                    <span>{part}</span>
                  </Fragment>
                ))}
              </p>
            ) : null}
          </button>
          {transcriptionStatus ? (
            <span className="mt-1 inline-flex min-h-6 max-w-full min-w-0 items-center text-xs text-fg-muted">
              {transcriptionStatus}
            </span>
          ) : null}
          {meetingHref ? (
            <Link
              href={meetingHref}
              className="mt-1 inline-flex text-xs text-fg-dim transition-colors hover:text-signal"
            >
              Open transcript
            </Link>
          ) : null}
        </div>
      </div>
      <div className="absolute right-2 top-2.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <PinOverflowMenu
          target={{ kind: 'timeline_moment', key: moment.id }}
          title={title}
          initialPinned={pinned}
        />
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
  serverMoments,
  pinnedMomentIds = new Set<string>(),
  emptyLabel = 'No events yet',
  emptyAction,
  impactFilter = 'all',
  impactItemsByEventId,
  artifactClustersByEventId = EMPTY_ARTIFACT_CLUSTERS_BY_EVENT_ID,
  capturedFilesByEventId = EMPTY_CAPTURED_FILES_BY_EVENT_ID,
  focusEventId = null,
  focusMomentId = null,
  timezone,
  mode = 'moments',
}: Props) {
  const workspaceTimezone = useWorkspaceTimezone();
  const resolvedTimezone = timezone ?? workspaceTimezone;
  const inspector = useInspector();
  const autoOpenedFocusRef = useRef<string | null>(null);
  const localMoments = useMemo(
    () =>
      buildTimelineMoments(
        events,
        authorMap,
        impactItemsByEventId === undefined
          ? { artifactClustersByEventId, timezone: resolvedTimezone, groupingMode: mode }
          : {
              impactItemsByEventId,
              artifactClustersByEventId,
              timezone: resolvedTimezone,
              groupingMode: mode,
            },
      ),
    [events, authorMap, impactItemsByEventId, artifactClustersByEventId, resolvedTimezone, mode],
  );
  const moments = serverMoments ?? localMoments;
  const focusedMoments =
    focusEventId === null && focusMomentId === null
      ? []
      : moments.filter(
          (moment) =>
            moment.id === focusMomentId ||
            moment.rawEvents.some((event) => event.id === focusEventId),
        );
  const filteredMoments = mergeTimelineMoments(
    filterTimelineMomentsByImpact(moments, impactFilter),
    focusedMoments,
  );
  const visibleMoments =
    typeof maxMoments === 'number' ? filteredMoments.slice(0, maxMoments) : filteredMoments;
  const dateGroups = groupedByDate(visibleMoments);
  const focusKey = focusMomentId ?? focusEventId;
  const focusedMoment =
    focusKey === null
      ? null
      : (visibleMoments.find(
          (moment) =>
            moment.id === focusMomentId ||
            moment.rawEvents.some((event) => event.id === focusEventId),
        ) ?? null);

  useEffect(() => {
    if (!focusKey || !focusedMoment) return;
    const openKey = `${focusKey}:${focusedMoment.id}`;
    if (autoOpenedFocusRef.current === openKey) return;
    autoOpenedFocusRef.current = openKey;
    inspector.show(
      momentInspectorContent({
        moment: focusedMoment,
        audioUrlMap,
        currentUserId,
        isAdmin,
        members,
        capturedFilesByEventId,
        timezone: resolvedTimezone,
      }),
    );
  }, [
    audioUrlMap,
    capturedFilesByEventId,
    currentUserId,
    focusKey,
    focusedMoment,
    inspector,
    isAdmin,
    members,
    resolvedTimezone,
  ]);

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
        <p className="text-sm text-fg-dim">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      aria-label={
        compact ? 'Recent timeline moments' : mode === 'events' ? 'All events' : 'Timeline moments'
      }
      data-timeline-mode={mode}
    >
      {dateGroups.map(([date, group]) => (
        <section key={date} aria-labelledby={`timeline-date-${date}`}>
          <h2
            id={`timeline-date-${date}`}
            className={cn(
              'sticky z-10 -mx-3 border-y border-border bg-bg px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim',
              compact ? 'top-0' : 'top-11',
            )}
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
                focused={
                  moment.id === focusMomentId ||
                  moment.rawEvents.some((event) => event.id === focusEventId)
                }
                compact={compact}
                pinned={pinnedMomentIds.has(moment.id)}
                timezone={resolvedTimezone}
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
