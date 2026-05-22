import { type InferSelectModel } from '@timeline/db';
import { Inbox } from 'lucide-react';

import type { rawEvents } from '@timeline/db';

import { Badge } from '@/components/ui/badge';
import { initials } from '@/lib/initials';

type RawEvent = InferSelectModel<typeof rawEvents>;

interface Props {
  events: RawEvent[];
  authorMap: Map<string, { id: string; name: string | null; email: string }>;
  /** Signed GET URLs keyed by event id. Missing entries render the player disabled. */
  audioUrlMap?: Map<string, string>;
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
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
  // Shape is enforced by the email dispatcher's metadata composer; the
  // JSONB column has no compile-time shape information here. Since every
  // EmailMeta field is optional, an empty object satisfies the type and
  // TS narrows `unknown → object` to a structurally compatible value.
  return meta;
}

function fmtAddr(a: { email: string; name?: string } | undefined): string {
  if (!a) return '';
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function TimelineList({ events, authorMap, audioUrlMap }: Props) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center">
        <Inbox className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Capture a note above to start your timeline.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-4">
      {events.map((event) => {
        const author = event.authorUserId ? authorMap.get(event.authorUserId) : null;
        const isEmail = event.source === 'email';
        const em = isEmail ? emailMeta(event.sourceMetadata) : null;
        const senderUnverified = Boolean(em?.sender_unverified);
        const authorLabel = author
          ? (author.name ?? author.email)
          : isEmail && em?.from
            ? fmtAddr(em.from)
            : 'System';
        return (
          <li key={event.id} id={`ev-${event.id}`} className="scroll-mt-20">
            <article className="rounded-xl border bg-card p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold tracking-tight text-primary">
                  {initials(authorLabel)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="truncate font-medium text-foreground">{authorLabel}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatWhen(event.occurredAt)}
                    </span>
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="font-normal">
                        {event.source}
                      </Badge>
                      {senderUnverified ? (
                        <Badge
                          variant="destructive"
                          className="font-normal"
                          title="From address does not match a team member"
                        >
                          unverified sender
                        </Badge>
                      ) : null}
                      {event.visibility === 'private' ? (
                        <Badge variant="secondary" className="font-normal">
                          private
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {isEmail && em ? (
                      <div className="space-y-1 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs">
                        {em.subject ? (
                          <p className="text-sm font-medium text-foreground">{em.subject}</p>
                        ) : null}
                        {em.forwarded_from ? (
                          <p className="text-muted-foreground">
                            Forwarded from{' '}
                            <span className="text-foreground">{fmtAddr(em.forwarded_from)}</span>
                          </p>
                        ) : null}
                        {em.thread_root_id && em.thread_root_id !== event.id ? (
                          <p className="text-muted-foreground">
                            Thread:{' '}
                            <a href={`#ev-${em.thread_root_id}`} className="underline">
                              view root
                            </a>
                          </p>
                        ) : null}
                        {em.attachments && em.attachments.length > 0 ? (
                          <p className="text-muted-foreground">
                            {em.attachments.length} attachment
                            {em.attachments.length === 1 ? '' : 's'}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {event.contentAudioUrl ? (
                      audioUrlMap?.get(event.id) ? (
                        <audio
                          src={audioUrlMap.get(event.id)}
                          controls
                          preload="metadata"
                          className="w-full"
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">[audio unavailable]</p>
                      )
                    ) : null}
                    {event.contentText !== null ? (
                      event.contentText.trim() === '' ? (
                        <p className="text-sm italic text-muted-foreground">(no speech detected)</p>
                      ) : (
                        <p className="whitespace-pre-wrap text-[15px] leading-7">
                          {event.contentText}
                        </p>
                      )
                    ) : event.contentAudioUrl ? (
                      transcribeFailed(event.sourceMetadata) ? (
                        <p className="text-sm italic text-muted-foreground">
                          Transcription failed — voice memo is still playable.
                        </p>
                      ) : (
                        <p className="text-sm italic text-muted-foreground">Transcribing…</p>
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">[empty event]</p>
                    )}
                  </div>
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
