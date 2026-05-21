import { type InferSelectModel } from '@timeline/db';

import type { rawEvents } from '@timeline/db';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

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
  // JSONB column has no compile-time shape information here.
  return meta;
}

function fmtAddr(a: { email: string; name?: string } | undefined): string {
  if (!a) return '';
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function TimelineList({ events, authorMap, audioUrlMap }: Props) {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing here yet. Capture a note above.
        </CardContent>
      </Card>
    );
  }

  return (
    <ol className="space-y-3">
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
            <Card>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{authorLabel}</span>
                  <span>·</span>
                  <span>{formatWhen(event.occurredAt)}</span>
                  <Badge variant="outline" className="ml-auto">
                    {event.source}
                  </Badge>
                  {senderUnverified ? (
                    <Badge variant="destructive" title="From address does not match a team member">
                      unverified sender
                    </Badge>
                  ) : null}
                  {event.visibility === 'private' ? (
                    <Badge variant="secondary">private</Badge>
                  ) : null}
                </div>
                {isEmail && em ? (
                  <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                    {em.subject ? (
                      <p className="font-medium text-foreground">{em.subject}</p>
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
                        {em.attachments.length} attachment{em.attachments.length === 1 ? '' : 's'}
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
                    // Worker successfully transcribed but the audio was silent
                    // or had no detectable speech. Show a distinct placeholder
                    // so the user doesn't think the transcript is still pending.
                    <p className="text-sm italic text-muted-foreground">(no speech detected)</p>
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-7">{event.contentText}</p>
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
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
