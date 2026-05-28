import { type InferSelectModel } from '@timeline/db';
import { Trash2 } from 'lucide-react';

import type { rawEvents } from '@timeline/db';

import { removeTelegramEventAction } from '@/app/actions/events';
import { EventVisibilityForm } from '@/components/event-visibility-form';
import { Button } from '@/components/ui/button';

type RawEvent = InferSelectModel<typeof rawEvents>;
type TimelineEvent = Omit<RawEvent, 'occurredAt' | 'createdAt'> & {
  occurredAt: Date | string;
  createdAt: Date | string;
};

interface Props {
  events: TimelineEvent[];
  authorMap: Map<string, { id: string; name: string | null; email: string }>;
  /** Signed GET URLs keyed by event id. Missing entries render the player disabled. */
  audioUrlMap?: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  members?: { id: string; label: string }[];
}

// Mono ISO-ish timestamp for the left column. We render local time so the
// 8-char clock face stays consistent across rows; the inspector pane shows
// the full UTC ISO string for forensic correctness.
function eventDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function formatTimestamp(input: Date | string): string {
  const d = eventDate(input);
  const date = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time}`;
}

function transcribeFailed(meta: unknown): boolean {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    typeof (meta as Record<string, unknown>).transcription_failed_at === 'string'
  );
}

interface EmailMeta {
  subject?: string;
  from?: { email: string; name?: string };
  to?: { email: string; name?: string }[];
  cc?: { email: string; name?: string }[];
  thread_root_id?: string;
  sender_unverified?: boolean;
  forwarded_from?: { email: string; name?: string };
  attachments?: { filename: string; content_type: string; size_bytes: number }[];
}

function emailMeta(meta: unknown): EmailMeta | null {
  if (typeof meta !== 'object' || meta === null) return null;
  return meta;
}

function fmtAddr(a: { email: string; name?: string } | undefined): string {
  if (!a) return '';
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

interface MeetingMeta {
  meeting_id?: string;
  title?: string;
  summary?: string;
  speakers?: string[];
  duration_minutes?: number;
  chunk_count?: number;
  action_items?: { text: string; owner: string | null }[];
}

function meetingMeta(meta: unknown): MeetingMeta | null {
  if (typeof meta !== 'object' || meta === null) return null;
  if (!('meeting_id' in meta)) return null;
  return meta as MeetingMeta;
}

const SOURCE_LABEL: Record<string, string> = {
  email: 'EMAIL',
  telegram: 'TG',
  voice: 'VOICE',
  text: 'TEXT',
  system: 'SYS',
  meeting: 'MEET',
};

/**
 * Operational Archive flat timeline. Each event is an indexed row, not a
 * card. Three columns: mono timestamp · body · source label.
 *
 *   2026-05-25 14:02   miriam · "ship tomorrow"               EMAIL
 *   2026-05-25 13:48   jay · voice 2m11s · "cut docs"         VOICE
 */
export function TimelineList({
  events,
  authorMap,
  audioUrlMap,
  currentUserId,
  isAdmin,
  members = [],
}: Props) {
  if (events.length === 0) {
    return (
      <div className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
        NO EVENTS YET → CAPTURE FROM ABOVE
      </div>
    );
  }

  return (
    <ol className="border-t border-border" aria-label="Captured events, most recent first">
      {events.map((event) => {
        const author = event.authorUserId ? authorMap.get(event.authorUserId) : null;
        const isEmail = event.source === 'email';
        const isMeeting = event.source === 'meeting';
        const canRemoveTelegram =
          event.source === 'telegram' && (isAdmin || event.authorUserId === currentUserId);
        const em = isEmail ? emailMeta(event.sourceMetadata) : null;
        const mm = isMeeting ? meetingMeta(event.sourceMetadata) : null;
        const meetingChunkCount =
          isMeeting && typeof mm?.chunk_count === 'number' ? mm.chunk_count : null;
        const senderUnverified = Boolean(em?.sender_unverified);
        const authorLabel = author
          ? (author.name ?? author.email)
          : isEmail && em?.from
            ? fmtAddr(em.from)
            : isMeeting && mm?.speakers?.length
              ? mm.speakers.join(', ')
              : 'system';
        const sourceLabel = SOURCE_LABEL[event.source] ?? event.source.toUpperCase();
        const canEditVisibility = event.visibilityOwnerUserId === currentUserId;
        return (
          <li
            key={event.id}
            id={`ev-${event.id}`}
            className="grid scroll-mt-20 grid-cols-[18ch_1fr] gap-x-4 gap-y-2 border-b border-border py-3 transition-colors hover:bg-surface md:grid-cols-[18ch_1fr_10ch]"
          >
            <time
              dateTime={eventDate(event.occurredAt).toISOString()}
              className="font-mono text-xs text-fg-dim"
            >
              {formatTimestamp(event.occurredAt)}
            </time>
            <div className="min-w-0 text-sm leading-snug">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium text-fg">{authorLabel}</span>
                {senderUnverified ? (
                  <span
                    className="font-mono text-[11px] uppercase tracking-[0.1em] text-danger"
                    title="From address does not match a team member"
                  >
                    unverified
                  </span>
                ) : null}
                {event.visibility === 'private' ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    private
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 space-y-2">
                {isMeeting && mm ? (
                  <>
                    {mm.title ? <p className="text-sm font-medium text-fg">{mm.title}</p> : null}
                    <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                      {mm.duration_minutes ? `${String(mm.duration_minutes)}min` : ''}
                      {mm.duration_minutes && mm.speakers?.length ? ' · ' : ''}
                      {mm.speakers?.length
                        ? `${String(mm.speakers.length)} speaker${mm.speakers.length === 1 ? '' : 's'}`
                        : ''}
                    </p>
                  </>
                ) : null}
                {isEmail && em?.subject ? (
                  <p className="text-sm font-medium text-fg">{em.subject}</p>
                ) : null}
                {isEmail && em?.forwarded_from ? (
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    fwd from <span className="text-fg">{fmtAddr(em.forwarded_from)}</span>
                  </p>
                ) : null}
                {isEmail && em?.thread_root_id && em.thread_root_id !== event.id ? (
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    thread →{' '}
                    <a href={`#ev-${em.thread_root_id}`} className="text-signal underline">
                      root
                    </a>
                  </p>
                ) : null}
                {isEmail && em?.attachments && em.attachments.length > 0 ? (
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    {em.attachments.length} attachment
                    {em.attachments.length === 1 ? '' : 's'}
                  </p>
                ) : null}
                {event.contentAudioUrl ? (
                  audioUrlMap?.get(event.id) ? (
                    <audio
                      src={audioUrlMap.get(event.id)}
                      controls
                      preload="metadata"
                      className="w-full max-w-md"
                    />
                  ) : (
                    <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                      [audio unavailable]
                    </p>
                  )
                ) : null}
                {isMeeting && mm?.summary ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                    {mm.summary}
                  </p>
                ) : event.contentText !== null ? (
                  event.contentText.trim() === '' ? (
                    <p className="text-sm italic text-fg-dim">(no speech detected)</p>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                      {isMeeting && meetingChunkCount !== null
                        ? meetingChunkCount > 0
                          ? '(transcript available)'
                          : '(no transcript captured)'
                        : event.contentText}
                    </p>
                  )
                ) : event.contentAudioUrl ? (
                  transcribeFailed(event.sourceMetadata) ? (
                    <p className="text-sm italic text-fg-dim">
                      Transcription failed — voice memo is still playable.
                    </p>
                  ) : (
                    <p className="text-sm italic text-fg-dim">Transcribing…</p>
                  )
                ) : (
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    [empty event]
                  </p>
                )}
                {isMeeting && mm?.action_items && mm.action_items.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-sm text-fg-muted">
                    {mm.action_items.map((ai, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-px text-fg-dim">-</span>
                        <span>
                          {ai.text}
                          {ai.owner ? (
                            <span className="ml-1 font-mono text-[11px] text-fg-dim">
                              ({ai.owner})
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canEditVisibility ? (
                  <details className="pt-1 text-xs">
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
              </div>
            </div>
            <div className="col-start-2 -mt-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim md:col-start-3 md:mt-0 md:justify-end md:text-right">
              <span aria-hidden="true">{sourceLabel}</span>
              {canRemoveTelegram ? (
                <form action={removeTelegramEventAction}>
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
            <span className="sr-only">Source: {sourceLabel}</span>
          </li>
        );
      })}
    </ol>
  );
}
