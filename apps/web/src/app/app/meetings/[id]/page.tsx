import { withTeam } from '@timeline/shared/team-scope';
import { notFound, redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { HistoryBackLink } from '@/components/history-back-link';
import { MeetingExportButtons } from '@/components/meeting-export-buttons';
import { CancelMeetingButton } from '@/components/meeting-forms';
import { PageHeader } from '@/components/page-header';
import { PinButton } from '@/components/pins/pin-button';
import { SectionHeading } from '@/components/section-heading';
import { TechnicalDetails } from '@/components/technical-details';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';
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
  const [chunks, calendarSettings, initialPinned] = await Promise.all([
    scope.meetings.listChunks(id),
    scope.calendar.getCalendarSettings(),
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

  return (
    <div className="space-y-6">
      <HistoryBackLink fallbackHref="/app/meetings" label="Back" />
      <PageHeader
        title={title}
        subtitle={displaySourceLabel(meeting.platform)}
        metadata={[
          { label: 'Status', value: statusLabel(meeting.status) },
          {
            label: 'Captured',
            value: formatDisplayDateTime(meeting.createdAt, {
              timezone: calendarSettings.defaultTimezone,
            }),
            mono: true,
          },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <PinButton target={{ kind: 'meeting', key: meeting.id }} initialPinned={initialPinned} />
        <MeetingExportButtons title={title} transcriptText={transcriptExport} />
        {cancellable ? <CancelMeetingButton meetingId={meeting.id} /> : null}
      </div>
      <TechnicalDetails
        items={[
          { label: 'Meeting ID', value: meeting.id, copyValue: meeting.id },
          { label: 'Meeting URL', value: meeting.meetingUrl, copyValue: meeting.meetingUrl },
        ]}
      >
        <a
          href={meeting.meetingUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-signal underline"
        >
          Open meeting link
        </a>
      </TechnicalDetails>

      {summary ? (
        <section className="space-y-2 rounded-lg border bg-muted/30 p-4">
          <SectionHeading>Summary</SectionHeading>
          <p className="whitespace-pre-wrap text-sm">{summary}</p>
        </section>
      ) : null}

      <section className="space-y-2">
        <SectionHeading>Transcript</SectionHeading>
        {chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {meeting.status === 'pending' || meeting.status === 'joining'
              ? 'Waiting for the notetaker to join…'
              : 'No transcript chunks captured.'}
          </p>
        ) : (
          <ol className="space-y-2 rounded-lg border p-3 text-sm">
            {chunks.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  {formatMeetingOffset(c.startMs)}
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
