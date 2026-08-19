import { withTeam } from '@timeline/shared/team-scope';
import { ExternalLink } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { HistoryBackLink } from '@/components/history-back-link';
import { MeetingExportButtons } from '@/components/meeting-export-buttons';
import { CancelMeetingButton } from '@/components/meeting-forms';
import { PageHeader } from '@/components/page-header';
import { PinButton } from '@/components/pins/pin-button';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { SectionHeading } from '@/components/section-heading';
import { TechnicalDetails } from '@/components/technical-details';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMeetingLabel, displaySourceLabel } from '@/lib/display-labels';
import { formatMeetingOffset, formatTranscriptExport } from '@/lib/meeting-transcript-export';
import { statusLabel } from '@/lib/status-labels';

export const metadata: Metadata = {
  title: 'Meeting',
  description: 'Review meeting transcript and timeline details.',
};

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function renderMeetingHeaderActions({
  meetingId,
  meetingUrl,
  initialPinned,
  title,
  transcriptExport,
  cancellable,
}: {
  meetingId: string;
  meetingUrl: string;
  initialPinned: boolean;
  title: string;
  transcriptExport: string;
  cancellable: boolean;
}) {
  return (
    <ItemActionGroup label={`Actions for ${title}`}>
      <Button asChild variant="outline" size="sm">
        <a
          href={meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open meeting in a new tab"
        >
          Open meeting
          <ExternalLink aria-hidden="true" />
        </a>
      </Button>
      <PinButton target={{ kind: 'meeting', key: meetingId }} initialPinned={initialPinned} />
      <MeetingExportButtons title={title} transcriptText={transcriptExport} />
      {cancellable ? <CancelMeetingButton meetingId={meetingId} /> : null}
    </ItemActionGroup>
  );
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

  const meeting = await scope.meetings.getMeeting(id);
  if (!meeting) notFound();
  const [chunks, initialPinned] = await Promise.all([
    scope.meetings.listChunks(id),
    scope.pins.isPinned({ kind: 'meeting', key: meeting.id }),
  ]);

  const summary = typeof meeting.metadata.summary === 'string' ? meeting.metadata.summary : null;
  const cancellable = ['pending', 'joining', 'active'].includes(meeting.status);
  const title = displayMeetingLabel(meeting);
  const transcriptExport = formatTranscriptExport({
    title,
    platform: meeting.platform,
    status: meeting.status,
    createdAt: meeting.createdAt,
    meetingUrl: meeting.meetingUrl,
    summary,
    chunks,
  });
  const headerActions = renderMeetingHeaderActions({
    meetingId: meeting.id,
    meetingUrl: meeting.meetingUrl,
    initialPinned,
    title,
    transcriptExport,
    cancellable,
  });

  return (
    <div className="space-y-6">
      <ChatViewContextBinder
        viewKey={`meeting:${meeting.id}`}
        kind="meeting"
        href={`/app/meetings/${meeting.id}`}
        label={title}
        meetingId={meeting.id}
      />
      <HistoryBackLink fallbackHref="/app/meetings" label="Back" />
      <PageHeader
        title={title}
        subtitle={displaySourceLabel(meeting.platform)}
        metadata={[
          { label: 'Status', value: statusLabel(meeting.status) },
          {
            label: 'Captured',
            value: <RelativeTimestamp value={meeting.createdAt} />,
            mono: true,
          },
        ]}
        trailing={headerActions}
      />
      <TechnicalDetails
        items={[{ label: 'Meeting ID', value: meeting.id, copyValue: meeting.id }]}
      />

      {summary ? (
        <section className="space-y-2 border-y border-border py-4">
          <SectionHeading>Summary</SectionHeading>
          <p className="whitespace-pre-wrap text-sm">{summary}</p>
        </section>
      ) : null}

      <section className="space-y-2">
        <SectionHeading>Transcript</SectionHeading>
        {chunks.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {meeting.status === 'pending' || meeting.status === 'joining'
              ? 'Waiting for the notetaker to join…'
              : 'No transcript chunks captured.'}
          </p>
        ) : (
          <ol className="space-y-2 border-y border-border py-3 text-sm">
            {chunks.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs text-fg-muted">
                  {formatMeetingOffset(c.startMs)}
                </span>
                <span className="flex-1">
                  {c.speaker ? <span className="font-medium text-fg">{c.speaker}: </span> : null}
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
