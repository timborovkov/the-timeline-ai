import { type InferSelectModel } from '@timeline/db';
import { Inbox } from 'lucide-react';

import type { rawEvents } from '@timeline/db';

import { Badge } from '@/components/ui/badge';

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
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
        const authorLabel = author ? (author.name ?? author.email) : 'System';
        return (
          <li key={event.id} id={`ev-${event.id}`} className="scroll-mt-20">
            <article className="rounded-xl border bg-card p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold tracking-tight text-primary">
                  {initials(authorLabel)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-foreground">{authorLabel}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatWhen(event.occurredAt)}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Badge variant="outline" className="font-normal">
                        {event.source}
                      </Badge>
                      {event.visibility === 'private' ? (
                        <Badge variant="secondary" className="font-normal">
                          private
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
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
                        <p className="text-sm italic text-muted-foreground">
                          (no speech detected)
                        </p>
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
