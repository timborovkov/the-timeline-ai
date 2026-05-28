'use client';

import {
  Bot,
  CalendarDays,
  Cable,
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
import { EventVisibilityForm } from '@/components/event-visibility-form';
import { useInspector } from '@/components/inspector-context';
import { Button } from '@/components/ui/button';
import {
  buildTimelineMoments,
  filterTimelineMomentsByImpact,
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
  density?: 'comfortable' | 'dense';
  impactFilter?: TimelineImpactFilter;
  impactItemsByEventId?: Record<string, ImpactItem[]>;
}

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
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
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
  const metadata = moment.rawEvents.flatMap((event) =>
    typeof event.sourceMetadata === 'object' && event.sourceMetadata !== null
      ? Object.entries(event.sourceMetadata as Record<string, unknown>).slice(0, 8)
      : [],
  );
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-fg">SOURCE TRUTH</h3>
        <p>
          {moment.actorLabel} · {moment.contextLabel} · {moment.sourceLabel}
        </p>
      </section>
      <section>
        <h3 className="mb-2 text-fg">TIMELINE CONTROL</h3>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          <dt>visibility</dt>
          <dd>{moment.rawEvents.map((event) => event.visibility).join(', ')}</dd>
          <dt>events</dt>
          <dd>{moment.rawEvents.length}</dd>
          <dt>first event</dt>
          <dd>{moment.rawEvents.at(-1)?.id ?? 'unknown'}</dd>
        </dl>
      </section>
      {moment.impactItems.length > 0 ? (
        <section>
          <h3 className="mb-2 text-fg">IMPACT CONTEXT</h3>
          <ul className="space-y-1">
            {moment.impactItems.map((item, index) => (
              <li key={`${item.kind}:${item.label}:${index}`}>
                {item.href ? (
                  <Link href={item.href}>
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
        <h3 className="mb-2 text-fg">RAW EVENTS</h3>
        <ol className="space-y-2">
          {moment.rawEvents.map((event) => (
            <li key={event.id}>
              [{event.id}]<br />
              {formatTimestamp(event.occurredAt)}
            </li>
          ))}
        </ol>
      </section>
      {metadata.length > 0 ? (
        <section>
          <h3 className="mb-2 text-fg">SOURCE METADATA</h3>
          <dl className="space-y-1">
            {metadata.map(([key, value], index) => (
              <div key={`${key}:${index}`} className="grid grid-cols-[7rem_1fr] gap-2">
                <dt className="truncate text-fg-dim">{key}</dt>
                <dd className="truncate text-fg-muted">{formatMetadataValue(value)}</dd>
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
  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim transition-colors hover:text-fg">
        {moment.rawEvents.length} raw event{moment.rawEvents.length === 1 ? '' : 's'} · inspect
      </summary>
      <ol className="mt-3 space-y-3">
        {moment.rawEvents.map((event) => (
          <li
            key={event.id}
            id={`ev-${event.id}`}
            className="scroll-mt-20 border-l border-border pl-3"
          >
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
              <span>{formatTimestamp(event.occurredAt)}</span>
              <span>[{event.id}]</span>
              {event.visibility === 'private' ? <span>Private</span> : null}
            </div>
            {event.contentAudioUrl ? (
              audioUrlMap?.get(event.id) ? (
                <audio
                  src={audioUrlMap.get(event.id)}
                  controls
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
                    className="h-7 w-7 text-fg-dim hover:text-danger"
                    title="Remove from timeline"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Remove from timeline</span>
                  </Button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
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
  members = [],
  compact = false,
  maxMoments,
  emptyLabel = 'NO EVENTS YET',
  density = 'comfortable',
  impactFilter = 'all',
  impactItemsByEventId = {},
}: Props) {
  const moments = useMemo(
    () => buildTimelineMoments(events, authorMap, { impactItemsByEventId }),
    [events, authorMap, impactItemsByEventId],
  );
  const filteredMoments = filterTimelineMomentsByImpact(moments, impactFilter);
  const visibleMoments =
    typeof maxMoments === 'number' ? filteredMoments.slice(0, maxMoments) : filteredMoments;
  const dateGroups = groupedByDate(visibleMoments);

  if (visibleMoments.length === 0) {
    return (
      <div className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
        {emptyLabel}
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
