import { type InferSelectModel } from '@timeline/db';

import type { rawEvents } from '@timeline/db';

type RawEvent = InferSelectModel<typeof rawEvents>;

interface Props {
  events: RawEvent[];
  authorMap: Map<string, { id: string; name: string | null; email: string }>;
  /** Signed GET URLs keyed by event id. Missing entries render the player disabled. */
  audioUrlMap?: Map<string, string>;
}

// Mono ISO-ish timestamp for the left column. We render local time so the
// 8-char clock face stays consistent across rows; the inspector pane shows
// the full UTC ISO string for forensic correctness.
function formatTimestamp(d: Date): string {
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

const SOURCE_LABEL: Record<string, string> = {
  email: 'EMAIL',
  telegram: 'TG',
  voice: 'VOICE',
  text: 'TEXT',
  system: 'SYS',
};

/**
 * Operational Archive flat timeline. Each event is an indexed row, not a
 * card. Three columns: mono timestamp · body · source label.
 *
 *   2026-05-25 14:02   miriam · "ship tomorrow"               EMAIL
 *   2026-05-25 13:48   jay · voice 2m11s · "cut docs"         VOICE
 */
export function TimelineList({ events, authorMap, audioUrlMap }: Props) {
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
        const em = isEmail ? emailMeta(event.sourceMetadata) : null;
        const senderUnverified = Boolean(em?.sender_unverified);
        const authorLabel = author
          ? (author.name ?? author.email)
          : isEmail && em?.from
            ? fmtAddr(em.from)
            : 'system';
        const sourceLabel =
          SOURCE_LABEL[event.source ?? 'system'] ?? event.source?.toUpperCase() ?? 'SYS';
        return (
          <li
            key={event.id}
            id={`ev-${event.id}`}
            className="grid scroll-mt-20 grid-cols-[18ch_1fr] gap-x-4 gap-y-2 border-b border-border py-3 transition-colors hover:bg-surface md:grid-cols-[18ch_1fr_10ch]"
          >
            <time
              dateTime={event.occurredAt.toISOString()}
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
                {event.contentText !== null ? (
                  event.contentText.trim() === '' ? (
                    <p className="text-sm italic text-fg-dim">(no speech detected)</p>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                      {event.contentText}
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
              </div>
            </div>
            <span
              aria-hidden="true"
              className="col-start-2 -mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim md:col-start-3 md:mt-0 md:text-right"
            >
              {sourceLabel}
            </span>
            <span className="sr-only">Source: {sourceLabel}</span>
          </li>
        );
      })}
    </ol>
  );
}
