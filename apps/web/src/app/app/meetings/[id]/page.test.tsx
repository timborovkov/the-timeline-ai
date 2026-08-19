import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getMeeting: vi.fn(),
  listChunks: vi.fn(),
  isPinned: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: fakes.notFound,
  redirect: fakes.redirect,
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    meetings: {
      getMeeting: fakes.getMeeting,
      listChunks: fakes.listChunks,
    },
    pins: { isPinned: fakes.isPinned },
  }),
}));
vi.mock('@/components/meeting-export-buttons', () => ({
  MeetingExportButtons: ({ transcriptText }: { transcriptText: string }) => (
    <output aria-label="transcript export">{transcriptText}</output>
  ),
}));
vi.mock('@/components/meeting-forms', () => ({
  CancelMeetingButton: ({ meetingId }: { meetingId: string }) => (
    <button type="button">Cancel {meetingId}</button>
  ),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));

const { default: MeetingDetailPage } = await import('./page.js');

const MEETING_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.requireMembership.mockResolvedValue(undefined);
  fakes.getMeeting.mockResolvedValue(meetingRow());
  fakes.isPinned.mockResolvedValue(false);
  fakes.listChunks.mockResolvedValue([
    {
      id: 'chunk-1',
      meetingId: MEETING_ID,
      speaker: 'Ada',
      text: 'We committed to send the launch packet by Friday.',
      startMs: 62_000,
      endMs: 68_000,
      createdAt: new Date('2026-07-01T12:02:00.000Z'),
    },
  ]);
});

describe('MeetingDetailPage', () => {
  it('renders completed transcript evidence with summary and export text', async () => {
    const html = renderToStaticMarkup(
      await MeetingDetailPage({ params: Promise.resolve({ id: MEETING_ID }) }),
    );

    expect(html).toContain('Customer launch sync');
    expect(html).toContain('Recall');
    expect(html).toContain('Completed');
    expect(html).toContain('Captured');
    expect(html).toContain('2026-07-01T12:00:00.000Z');
    expect(html).toContain('Open meeting');
    expect(html).toContain('aria-label="Open meeting in a new tab"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://meet.google.com/abc-defg-hij"');
    expect(html).toContain('Summary');
    expect(html).toContain('Acme confirmed launch readiness and Friday follow-up.');
    expect(html).toContain('Ada:');
    expect(html).toContain('We committed to send the launch packet by Friday.');
    expect(html).toContain('1:02');
    expect(html).toContain('## Transcript');
    expect(html).not.toContain(`Cancel ${MEETING_ID}`);

    const headerEnd = html.indexOf('</header>');
    expect(html.indexOf('Open meeting')).toBeLessThan(headerEnd);
    expect(html.indexOf('Pin')).toBeLessThan(headerEnd);
    expect(html.indexOf('transcript export')).toBeLessThan(headerEnd);
    expect(html).toContain('Meeting ID');
    expect(html).not.toContain('Meeting URL');
    expect(html).toContain('space-y-2 border-y border-border py-4');
    expect(html).toContain('space-y-2 border-y border-border py-3 text-sm');
    expect(html).toContain('font-mono text-xs text-fg-muted');
    expect(html).toContain('font-medium text-fg');
  });

  it('renders pending empty transcript state and exposes cancellation', async () => {
    fakes.getMeeting.mockResolvedValueOnce(
      meetingRow({ status: 'pending', metadata: {}, title: null }),
    );
    fakes.listChunks.mockResolvedValueOnce([]);

    const html = renderToStaticMarkup(
      await MeetingDetailPage({ params: Promise.resolve({ id: MEETING_ID }) }),
    );

    expect(html).toContain('Untitled meeting');
    expect(html).toContain('Recall');
    expect(html).toContain('Pending');
    expect(html).toContain('Waiting for the notetaker to join');
    expect(html).toContain(`Cancel ${MEETING_ID}`);
    expect(html.indexOf(`Cancel ${MEETING_ID}`)).toBeLessThan(html.indexOf('</header>'));
  });

  it('rejects invalid meeting ids before loading team data', async () => {
    await expect(
      MeetingDetailPage({ params: Promise.resolve({ id: 'not-a-uuid' }) }),
    ).rejects.toThrow('notFound');

    expect(fakes.auth).not.toHaveBeenCalled();
    expect(fakes.getMeeting).not.toHaveBeenCalled();
  });

  it('redirects signed-out users before scoped meeting lookup', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await expect(
      MeetingDetailPage({ params: Promise.resolve({ id: MEETING_ID }) }),
    ).rejects.toThrow('redirect:/sign-in');

    expect(fakes.getMeeting).not.toHaveBeenCalled();
  });
});

function meetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    teamId: 'team-1',
    createdByUserId: 'user-1',
    savedMeetingId: null,
    provider: 'recall',
    providerBotId: 'bot-1',
    platform: 'recall',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    title: 'Customer launch sync',
    status: 'completed',
    defaultVisibility: 'team',
    visibilityUserIds: [],
    metadata: { summary: 'Acme confirmed launch readiness and Friday follow-up.' },
    scheduledStartAt: null,
    startedAt: new Date('2026-07-01T12:00:00.000Z'),
    endedAt: new Date('2026-07-01T12:30:00.000Z'),
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    updatedAt: new Date('2026-07-01T12:30:00.000Z'),
    ...overrides,
  };
}
