import { type InferSelectModel } from '@timeline/db';

import type { rawEvents } from '@timeline/db';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type RawEvent = InferSelectModel<typeof rawEvents>;

interface Props {
  events: RawEvent[];
  authorMap: Map<string, { id: string; name: string | null; email: string }>;
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function TimelineList({ events, authorMap }: Props) {
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
        const authorLabel = author ? (author.name ?? author.email) : 'System';
        return (
          <li key={event.id}>
            <Card>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{authorLabel}</span>
                  <span>·</span>
                  <span>{formatWhen(event.occurredAt)}</span>
                  <Badge variant="outline" className="ml-auto">
                    {event.source}
                  </Badge>
                  {event.visibility === 'private' ? (
                    <Badge variant="secondary">private</Badge>
                  ) : null}
                </div>
                {event.contentText ? (
                  <p className="whitespace-pre-wrap text-[15px] leading-7">{event.contentText}</p>
                ) : event.contentAudioUrl ? (
                  <p className="text-sm text-muted-foreground">[audio attachment]</p>
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
