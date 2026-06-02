'use client';

import {
  Bot,
  CalendarDays,
  Cable,
  ExternalLink,
  FileText,
  Mail,
  MessageSquare,
  MousePointer,
  Send,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import type { TimelineEvent } from '@/lib/use-paginated-queries';

import { removeConversationalEventAction } from '@/app/actions/events';
import { EmptyAction } from '@/components/empty-action';
import { EventVisibilityForm } from '@/components/event-visibility-form';
import { useInspector } from '@/components/inspector-context';
import { Button } from '@/components/ui/button';
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
  density?: 'comfortable' | 'dense';
  impactFilter?: TimelineImpactFilter;
  impactItemsByEventId?: Record<string, ImpactItem[]>;
}

const EMPTY_MEMBERS: NonNullable<Props['members']> = [];

const SOURCE_ICON: Record<TimelineEvent['source'], LucideIcon> = {
  web: MousePointer,
  telegram: Send,
  email: Mail,
  system: Bot,
  document: FileText,
  meeting: Video,
  integration: Cable,
  calendar: CalendarDays,
  slack: MessageSquare,
};

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

function eventDate(input: string): Date {
  return new Date(input);
}

function formatTimestamp(input: string): string {
  return eventDate(input).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
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

function friendlyMeta(meta: Record<string, unknown>, key: string): string | null {
  const value = formatMetadataValue(meta[key]).trim();
  return value.length > 0 ? value : null;
}

function formatShortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
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

function addDetail(
  entries: [string, string][],
  seen: Set<string>,
  label: string,
  value: string | null,
) {
  if (!value || seen.has(label)) return;
  seen.add(label);
  entries.push([label, value]);
}

function inspectorSourceDetailEntries(moment: TimelineMoment): [string, string][] {
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  const actorByTelegramUserId = actorLabelsByTelegramUserId(moment.rawEvents);
  for (const event of moment.rawEvents) {
    if (typeof event.sourceMetadata !== 'object' || event.sourceMetadata === null) continue;
    const meta = event.sourceMetadata as Record<string, unknown>;
    if (event.source === 'telegram') {
      addDetail(entries, seen, 'Sender', rawEventActorLabel(event, actorByTelegramUserId));
      addDetail(entries, seen, 'Chat', stringMeta(meta, 'tg_chat_title'));
      addDetail(entries, seen, 'Chat type', stringMeta(meta, 'tg_chat_type'));
      addDetail(entries, seen, 'Caption', stringMeta(meta, 'tg_caption'));
    } else if (event.source === 'slack') {
      addDetail(entries, seen, 'Sender', stringMeta(meta, 'slack_sender_name'));
      addDetail(entries, seen, 'Channel', stringMeta(meta, 'slack_channel_name'));
    } else if (event.source === 'email') {
      addDetail(entries, seen, 'Subject', stringMeta(meta, 'subject'));
      addDetail(entries, seen, 'From', formatMetadataValue(meta.from).trim() || null);
    } else if (event.source === 'document') {
      addDetail(
        entries,
        seen,
        'Document',
        stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name'),
      );
      addDetail(entries, seen, 'Origin', stringMeta(meta, 'source'));
    } else if (event.source === 'meeting' || event.source === 'calendar') {
      addDetail(entries, seen, 'Title', stringMeta(meta, 'title'));
    } else if (event.source === 'integration') {
      addDetail(entries, seen, 'Provider', stringMeta(meta, 'provider'));
      addDetail(entries, seen, 'Event', stringMeta(meta, 'event_type'));
      addDetail(entries, seen, 'Actor', friendlyMeta(meta, 'actor'));
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
      (userId ? (actorByTelegramUserId.get(userId) ?? null) : null) ??
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
  return event.source;
}

function rawEventContextLabel(event: TimelineEvent): string | null {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'telegram') {
    return stringMeta(meta, 'tg_chat_title') ?? stringMeta(meta, 'tg_chat_type');
  }
  if (event.source === 'slack') {
    return stringMeta(meta, 'slack_channel_name') ?? stringMeta(meta, 'slack_channel_id');
  }
  if (event.source === 'document') {
    return stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name');
  }
  return null;
}

function rawEventDocumentLink(event: TimelineEvent): { href: string; label: string } | null {
  const meta = metaObject(event.sourceMetadata);
  const documentId = stringMeta(meta, 'document_id') ?? stringMeta(meta, 'documentId');
  if (!documentId) return null;
  return {
    href: `/app/documents/${documentId}`,
    label: stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name') ?? 'Attachment',
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

function InspectorBody({ moment }: { moment: TimelineMoment }) {
  const metadata = inspectorSourceDetailEntries(moment);
  const latestEvent = moment.rawEvents[0];
  const firstEvent = moment.rawEvents.at(-1);
  const visibleRawEvents = moment.rawEvents.slice(0, INSPECTOR_RAW_EVENT_LIMIT);
  const hiddenRawEventCount = moment.rawEvents.length - visibleRawEvents.length;

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
          Source truth
        </h3>
        <p className="text-sm leading-6 text-fg-muted">
          {moment.actorLabel} · {moment.contextLabel} · {moment.sourceLabel}
        </p>
      </section>
      <section>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
          Timeline control
        </h3>
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-fg-dim">visibility</dt>
          <dd className="min-w-0 break-words text-fg-muted">
            {formatVisibilitySummary(moment.rawEvents)}
          </dd>
          <dt className="text-fg-dim">events</dt>
          <dd>{moment.rawEvents.length}</dd>
          <dt className="text-fg-dim">first</dt>
          <dd className="min-w-0 break-all" title={firstEvent?.id}>
            {firstEvent ? formatShortId(firstEvent.id) : 'unknown'}
          </dd>
          <dt className="text-fg-dim">latest</dt>
          <dd className="min-w-0 break-all" title={latestEvent?.id}>
            {latestEvent ? formatShortId(latestEvent.id) : 'unknown'}
          </dd>
        </dl>
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
                  <Link href={item.href} className="text-fg hover:text-signal">
                    {IMPACT_LABEL[item.kind]} · {item.label}
                  </Link>
                ) : (
                  <>
                    {IMPACT_LABEL[item.kind]} · {item.label}
                  </>
                )}
                {item.status ? <span> · {item.status}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
          Raw events
        </h3>
        <ol className="space-y-1.5">
          {visibleRawEvents.map((event) => (
            <li
              key={event.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-sm border border-border bg-bg px-2 py-1.5"
            >
              <span className="min-w-0 break-all text-fg-muted" title={event.id}>
                [{formatShortId(event.id)}]
              </span>
              <time className="text-right text-fg-dim" dateTime={event.occurredAt}>
                {formatTimestamp(event.occurredAt)}
              </time>
            </li>
          ))}
        </ol>
        {hiddenRawEventCount > 0 ? (
          <p className="mt-2 rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-fg-dim">
            + {hiddenRawEventCount} older raw event{hiddenRawEventCount === 1 ? '' : 's'}
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

function RawEventExpansion({
  moment,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members,
}: {
  moment: TimelineMoment;
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
}) {
  const conversationEvents = [...moment.rawEvents].reverse();
  const actorByTelegramUserId = actorLabelsByTelegramUserId(moment.rawEvents);
  return (
    <details className="mt-3 border-t border-border pt-3" open={moment.rawEvents.length > 1}>
      <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim transition-colors hover:text-fg">
        {moment.rawEvents.length} raw event{moment.rawEvents.length === 1 ? '' : 's'} · inspect
      </summary>
      <ol className="mt-3 space-y-3">
        {conversationEvents.map((event, index) => {
          const documentLink = rawEventDocumentLink(event);
          const context = rawEventContextLabel(event);
          return (
            <li
              key={event.id}
              id={`ev-${event.id}`}
              className="scroll-mt-20 border-l border-border pl-3"
            >
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                <span>{index + 1}</span>
                <span>{formatTimestamp(event.occurredAt)}</span>
                <span>{event.source}</span>
                <span>{rawEventActorLabel(event, actorByTelegramUserId)}</span>
                {context ? <span>{context}</span> : null}
                <span>[{formatShortId(event.id)}]</span>
                {event.visibility === 'private' ? <span>Private</span> : null}
              </div>
              {documentLink ? (
                <Link
                  href={documentLink.href}
                  className="mt-2 inline-flex min-h-7 items-center rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted transition-colors hover:text-signal"
                >
                  Attachment · {documentLink.label}
                </Link>
              ) : null}
              {event.contentAudioUrl ? (
                audioUrlMap?.get(event.id) ? (
                  <audio
                    src={audioUrlMap.get(event.id)}
                    controls
                    aria-label="Voice memo"
                    preload="metadata"
                    className="mt-2 w-full max-w-md"
                  />
                ) : (
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    [audio unavailable]
                  </p>
                )
              ) : null}
              {event.contentText?.trim() ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                  {event.contentText}
                </p>
              ) : event.contentAudioUrl ? (
                <p className="mt-2 text-sm italic text-fg-dim">
                  {transcribeFailed(event.sourceMetadata)
                    ? 'Transcription failed; voice memo is still playable.'
                    : 'Transcribing...'}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {canEditVisibility(event, currentUserId) ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-mono uppercase tracking-[0.1em] text-fg-dim">
                      Visibility
                    </summary>
                    <EventVisibilityForm
                      eventId={event.id}
                      visibility={event.visibility}
                      visibilityUserIds={event.visibilityUserIds}
                      members={members}
                    />
                  </details>
                ) : null}
                {canRemoveConversational(event, currentUserId, isAdmin) ? (
                  <form action={removeConversationalEventAction}>
                    <input type="hidden" name="id" value={event.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-fg-dim hover:text-danger"
                      title="Remove from timeline"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      <span className="sr-only">Remove from timeline</span>
                    </Button>
                  </form>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ImpactStrip({ items }: { items: ImpactItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Impact context">
      {items.map((item, index) => {
        const count = item.count && item.count > 1 ? ` ×${item.count}` : '';
        const status = item.status ? ` · ${item.status}` : '';
        const label = `${IMPACT_LABEL[item.kind]} · ${item.label}${count}${status}`;
        const className =
          'inline-flex min-h-6 items-center rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted';
        return item.href ? (
          <Link key={`${item.kind}:${item.label}:${index}`} href={item.href} className={className}>
            {label}
          </Link>
        ) : (
          <span key={`${item.kind}:${item.label}:${index}`} className={className}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

function TimelineMomentRow({
  moment,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members,
  compact,
  density,
}: {
  moment: TimelineMoment;
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  compact: boolean;
  density: 'comfortable' | 'dense';
}) {
  const inspector = useInspector();
  const Icon = SOURCE_ICON[moment.source];
  const selected = inspector.open && inspector.content?.id === moment.id;
  const meetingHref = meetingDetailHrefForMoment(moment);
  return (
    <li
      className={cn(
        'grid grid-cols-[5.75rem_minmax(0,1fr)] border-b border-border transition-colors hover:bg-surface',
        density === 'dense' && 'grid-cols-[4.75rem_minmax(0,1fr)]',
        selected && 'bg-surface',
      )}
    >
      <div
        className={cn(
          'relative py-4 pr-4 font-mono text-xs text-fg-dim',
          density === 'dense' && 'py-3 text-[11px]',
        )}
      >
        <span>{moment.timeLabel}</span>
        <span aria-hidden="true" className="absolute right-1 top-0 h-full w-px bg-border" />
        <span
          className={cn(
            'absolute right-[-5px] top-5 grid size-3 place-items-center border border-border-strong bg-bg text-signal',
            density === 'dense' && 'top-4',
          )}
        >
          <Icon className="size-2.5" aria-hidden="true" />
        </span>
      </div>
      <div className={cn('min-w-0 py-4 pl-4', density === 'dense' && 'py-3')}>
        <button
          type="button"
          onClick={() => {
            inspector.show({
              id: moment.id,
              kind: moment.sourceLabel.toUpperCase(),
              render: () => <InspectorBody moment={moment} />,
            });
          }}
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            <span className="text-fg">{moment.sourceLabel}</span>
            <span>{moment.actorLabel}</span>
            <span>{moment.contextLabel}</span>
            <span>
              {moment.rawEvents.length} raw event{moment.rawEvents.length === 1 ? '' : 's'}
            </span>
          </div>
          <p
            className={cn(
              'mt-2 text-sm leading-relaxed text-fg-muted',
              (compact || density === 'dense') && 'line-clamp-2',
              density === 'dense' && 'mt-1 text-[13px] leading-6',
            )}
          >
            {moment.summary}
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
        <ImpactStrip items={moment.impactItems} />
        {!compact ? (
          <RawEventExpansion
            moment={moment}
            audioUrlMap={audioUrlMap}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            members={members}
          />
        ) : null}
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
  density = 'comfortable',
  impactFilter = 'all',
  impactItemsByEventId,
}: Props) {
  const moments = useMemo(
    () =>
      buildTimelineMoments(
        events,
        authorMap,
        impactItemsByEventId === undefined ? {} : { impactItemsByEventId },
      ),
    [events, authorMap, impactItemsByEventId],
  );
  const filteredMoments = filterTimelineMomentsByImpact(moments, impactFilter);
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
            className="sticky top-14 z-10 border-y border-border bg-bg py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim"
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
                compact={compact}
                density={density}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
