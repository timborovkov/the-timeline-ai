import { withTeam } from '@timeline/shared';
import { notFound, redirect } from 'next/navigation';

import { CancelMeetingButton } from '@/components/meeting-forms';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default async function MeetingDetailPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const meeting = await scope.getMeeting(id);
  if (!meeting) notFound();
  const chunks = await scope.listChunks(id);

  const summary = typeof meeting.metadata.summary === 'string' ? meeting.metadata.summary : null;
  const cancellable = ['pending', 'joining', 'active'].includes(meeting.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{meeting.title ?? `${meeting.platform} meeting`}</h1>
        <p className="text-xs text-muted-foreground">
          {meeting.platform} · {meeting.status} · {new Date(meeting.createdAt).toLocaleString()}
        </p>
        <p className="break-all text-xs text-muted-foreground">
          <a href={meeting.meetingUrl} target="_blank" rel="noreferrer" className="underline">
            {meeting.meetingUrl}
          </a>
        </p>
        {cancellable ? (
          <div className="pt-2">
            <CancelMeetingButton meetingId={meeting.id} />
          </div>
        ) : null}
      </header>

      {summary ? (
        <section className="space-y-2 rounded-lg border bg-muted/30 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Summary
          </h2>
          <p className="whitespace-pre-wrap text-sm">{summary}</p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Transcript
        </h2>
        {chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {meeting.status === 'pending' || meeting.status === 'joining'
              ? 'Waiting for the bot to join…'
              : 'No transcript chunks captured.'}
          </p>
        ) : (
          <ol className="space-y-2 rounded-lg border p-3 text-sm">
            {chunks.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  {fmtMs(c.startMs)}
                </span>
                <span className="flex-1">
                  {c.speaker ? (
                    <span className="font-medium text-foreground">{c.speaker}: </span>
                  ) : null}
                  {c.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
