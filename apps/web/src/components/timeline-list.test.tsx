// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TimelineEvent } from '@/lib/use-paginated-queries';
import type { ComponentProps, ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  showInspector: vi.fn(),
}));

vi.mock('@/app/actions/events', () => ({ removeConversationalEventAction: vi.fn() }));
vi.mock('@/components/documents/document-preview', () => ({
  DocumentPreview: () => createElement('button', { type: 'button' }, 'Preview'),
}));
vi.mock('@/components/event-visibility-form', () => ({
  EventVisibilityForm: () => createElement('div', null),
}));
vi.mock('@/components/inspector-context', () => ({
  useInspector: () => ({
    open: false,
    content: null,
    show: fakes.showInspector,
  }),
}));

const { TimelineList } = await import('./timeline-list.js');

interface InspectorContentForTest {
  render: () => ReactNode;
}

afterEach(() => {
  cleanup();
  fakes.showInspector.mockClear();
});

function renderLastInspector(): string {
  const lastCall = fakes.showInspector.mock.lastCall as [InspectorContentForTest] | undefined;
  if (!lastCall) throw new Error('Expected inspector content to be shown.');
  return renderToStaticMarkup(lastCall[0].render());
}

function renderLastInspectorContent() {
  const lastCall = fakes.showInspector.mock.lastCall as [InspectorContentForTest] | undefined;
  if (!lastCall) throw new Error('Expected inspector content to be shown.');
  return render(createElement('div', null, lastCall[0].render()));
}

function expectTextOrder(html: string, first: string, second: string) {
  const firstIndex = html.indexOf(first);
  const secondIndex = html.indexOf(second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThanOrEqual(0);
  expect(firstIndex).toBeLessThan(secondIndex);
}

function timelineEvent(input: {
  id: string;
  occurredAt: string;
  contentText?: string;
  contentAudioUrl?: string | null;
  source?: TimelineEvent['source'];
  sourceMetadata?: Record<string, unknown>;
}): TimelineEvent {
  return {
    id: input.id,
    teamId: 'team-1',
    authorUserId: null,
    source: input.source ?? 'meeting',
    contentText: input.contentText ?? 'Daily call notes',
    contentAudioUrl: input.contentAudioUrl ?? null,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: null,
    sourceMetadata: input.sourceMetadata ?? { meeting_id: 'meeting-1', title: 'Daily' },
  };
}

function renderTimeline(
  events: TimelineEvent[],
  options: Partial<ComponentProps<typeof TimelineList>> = {},
): string {
  return renderToStaticMarkup(
    createElement(TimelineList, {
      events,
      authorMap: new Map(),
      currentUserId: 'user-1',
      isAdmin: false,
      ...options,
    }),
  );
}

describe('TimelineList event anchors', () => {
  it('anchors single-event citation hashes on the visible moment row', () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    const html = renderTimeline([
      timelineEvent({ id: eventId, occurredAt: '2026-06-03T13:04:00.000Z' }),
    ]);

    expect(html).toContain('id="tm-moment_3Ameeting_3Ameeting-1"');
    expect(html).toContain('data-moment-id="moment:meeting:meeting-1"');
    expect(html).toContain(`id="ev-${eventId}"`);
    expect(html.match(new RegExp(`id="ev-${eventId}"`, 'g'))).toHaveLength(1);
  });

  it('keeps raw-event anchors for expanded multi-event moments', () => {
    const firstEventId = '22222222-2222-4222-8222-222222222222';
    const secondEventId = '33333333-3333-4333-8333-333333333333';
    const html = renderTimeline([
      timelineEvent({ id: firstEventId, occurredAt: '2026-06-03T13:04:00.000Z' }),
      timelineEvent({ id: secondEventId, occurredAt: '2026-06-03T13:05:00.000Z' }),
    ]);

    expect(html).toContain(`id="ev-${firstEventId}"`);
    expect(html).toContain(`id="ev-${secondEventId}"`);
    expect(html.match(new RegExp(`id="ev-${firstEventId}"`, 'g'))).toHaveLength(1);
    expect(html.match(new RegExp(`id="ev-${secondEventId}"`, 'g'))).toHaveLength(1);
  });

  it('keeps a focused event anchor visible through impact filters', () => {
    const focusedEventId = '44444444-4444-4444-8444-444444444444';
    const taskEventId = '55555555-5555-4555-8555-555555555555';
    const html = renderTimeline(
      [
        timelineEvent({ id: taskEventId, occurredAt: '2026-06-03T13:05:00.000Z' }),
        timelineEvent({ id: focusedEventId, occurredAt: '2026-06-03T13:04:00.000Z' }),
      ],
      {
        focusEventId: focusedEventId,
        impactFilter: 'task',
        impactItemsByEventId: {
          [taskEventId]: [{ kind: 'task', label: 'Follow up' }],
          [focusedEventId]: [],
        },
      },
    );

    expect(html).toContain(`id="ev-${focusedEventId}"`);
    expect(html).toContain(`id="ev-${taskEventId}"`);
    expect(html.match(new RegExp(`id="ev-${focusedEventId}"`, 'g'))).toHaveLength(1);
    expect(html).toContain('shadow-[inset_3px_0_0_var(--signal)]');
  });

  it('keeps a focused moment visible through impact filters', () => {
    const focusedEventId = '66666666-6666-4666-8666-666666666666';
    const taskEventId = '77777777-7777-4777-8777-777777777777';
    const html = renderTimeline(
      [
        timelineEvent({ id: taskEventId, occurredAt: '2026-06-03T13:05:00.000Z' }),
        timelineEvent({ id: focusedEventId, occurredAt: '2026-06-03T13:04:00.000Z' }),
      ],
      {
        focusMomentId: 'moment:meeting:meeting-1',
        impactFilter: 'task',
        impactItemsByEventId: {
          [taskEventId]: [{ kind: 'task', label: 'Follow up' }],
          [focusedEventId]: [],
        },
      },
    );

    expect(html).toContain('data-moment-id="moment:meeting:meeting-1"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(`id="ev-${focusedEventId}"`);
    expect(html).toContain(`id="ev-${taskEventId}"`);
    expect(html).toContain('shadow-[inset_3px_0_0_var(--signal)]');
  });
});

describe('TimelineList document attachments', () => {
  it('moves document previews into the inspector and keeps lifecycle rules', () => {
    const uploadId = '66666666-6666-4666-8666-666666666666';
    const renameId = '77777777-7777-4777-8777-777777777777';
    const generatedName =
      'AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg';
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: uploadId,
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'document',
            contentText: `Uploaded ${generatedName}`,
            sourceMetadata: {
              action: 'upload',
              document_id: '88888888-8888-4888-8888-888888888888',
              document_name: generatedName,
              document_version_id: '99999999-9999-4999-8999-999999999999',
            },
          }),
          timelineEvent({
            id: renameId,
            occurredAt: '2026-06-03T13:05:00.000Z',
            source: 'document',
            contentText: 'Renamed notes.txt',
            sourceMetadata: {
              action: 'rename',
              document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              document_name: 'notes.txt',
            },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Uploaded AgACAgQ/i }));
    const uploadInspector = renderLastInspector();
    expect(uploadInspector).toContain('Attachment · AgACAgQ…wADPAQ.jpg');
    expect(uploadInspector).toContain(`title="${generatedName}"`);
    expect(uploadInspector).toContain('Preview');

    fireEvent.click(screen.getByRole('button', { name: /Renamed notes\.txt/i }));
    const renameInspector = renderLastInspector();
    expect(renameInspector).toContain('Attachment · notes.txt');
    expect(renameInspector).not.toContain('Preview');
  });

  it('shows captured Telegram files in the inspector with truncated stored names and preview', () => {
    const eventId = '12121212-1212-4121-8121-121212121212';
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: eventId,
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'telegram',
            contentText:
              'Attached image AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg',
            sourceMetadata: { tg_chat_title: 'AuditAI', tg_sender_name: 'Tim' },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
        capturedFilesByEventId: {
          [eventId]: [
            {
              id: 'doc-captured',
              name: 'AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg',
              presentation: {
                displayTitle: 'Image attachment',
                storedName:
                  'AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg',
                suggestedTitle: null,
                isGeneratedName: true,
                fallbackTitle: 'Image attachment',
              },
              currentVersion: {
                id: 'version-captured',
                version: 1,
                contentType: 'image/jpeg',
                processingStatus: 'chunked',
              },
            },
          ],
        },
      }),
    );

    expect(document.body.textContent).toContain('Attached image AgACAgQ…wADPAQ.jpg');
    expect(document.body.textContent).not.toContain(
      'Attached image AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg',
    );

    fireEvent.click(screen.getByRole('button', { name: /Attached image AgACAgQ/i }));
    const inspector = renderLastInspector();
    expect(inspector).toContain('Attached image AgACAgQ…wADPAQ.jpg');
    expect(inspector).toContain('Attachment · Image attachment');
    expect(inspector).toContain('Stored as');
    expect(inspector).toContain('AgACAgQ…wADPAQ.jpg');
    expect(inspector).toContain('Preview');
    expect(inspector).toContain('>Attached image AgACAgQ…wADPAQ.jpg</p>');
  });

  it('uses attachment metadata for file-only source rows beyond Telegram', () => {
    const eventId = '13131313-1313-4131-8131-131313131313';
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: eventId,
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'slack',
            contentText: '',
            sourceMetadata: {
              slack_channel_name: 'design',
              slack_sender_name: 'Alex',
              attachments: [
                {
                  name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
                  mimetype: 'image/jpeg',
                },
              ],
            },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    expect(document.body.textContent).toContain('Attached image AgACAgQ…msbjOI.jpg');
    expect(document.body.textContent).not.toContain(
      'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
    );

    fireEvent.click(screen.getByRole('button', { name: /Attached image AgACAgQ/i }));
    const inspector = renderLastInspector();
    expect(inspector).toContain('Attached image AgACAgQ…msbjOI.jpg');
    expect(inspector).not.toContain(
      'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
    );
  });
});

describe('TimelineList moment presentation', () => {
  it('opens the inspector automatically for focused moment links', async () => {
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: '15151515-1515-4151-8151-151515151515',
            occurredAt: '2026-06-03T13:04:00.000Z',
            contentText: 'Daily call notes',
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
        focusMomentId: 'moment:meeting:meeting-1',
      }),
    );

    await waitFor(() => {
      expect(fakes.showInspector).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'moment:meeting:meeting-1',
          title: 'Daily',
        }),
      );
    });

    expect(renderLastInspector()).toContain('Source evidence');
  });

  it('uses readable moment and evidence section names in the inspector', () => {
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: '14141414-1414-4141-8141-141414141414',
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'telegram',
            contentText: 'Done / 16.20-16.30 asti vapaa täs about',
            sourceMetadata: { tg_chat_title: 'AuditAI', tg_sender_name: 'Tim' },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    expect(screen.getByText('1 signal')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Done \/ 16\.20/i }));
    const inspector = renderLastInspector();
    expect(inspector).toContain('Moment');
    expect(inspector).toContain('Evidence summary');
    expect(inspector).toContain('1 evidence item');
    expect(inspector).toContain('Source evidence');
    expect(inspector).toContain('Technical details');
    expect(inspector).not.toContain('Why this row exists');
    expect(inspector).not.toContain('Source truth');
    expect(inspector).not.toContain('1 source event');
  });

  it('orders inspector evidence before controls and technical details', () => {
    const eventId = '15151515-1515-4151-8151-151515151515';
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: eventId,
            occurredAt: '2026-06-03T13:04:00.000Z',
            contentText: 'Voice note summary',
            contentAudioUrl: 'teams/team-1/meeting/audio.m4a',
          }),
        ],
        authorMap: new Map(),
        audioUrlMap: new Map([[eventId, '/audio/current.m4a']]),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Voice note summary/i }));
    const inspector = renderLastInspector();
    expectTextOrder(inspector, 'Moment', 'Source evidence');
    expectTextOrder(inspector, 'Source evidence', 'Controls');
    expectTextOrder(inspector, 'Controls', 'Technical details');
  });
});

describe('TimelineList inspector source caps', () => {
  it('shows the latest source evidence while keeping controls for hidden older evidence', () => {
    const events = Array.from({ length: 9 }, (_, index) =>
      timelineEvent({
        id: `99999999-9999-4999-8999-99999999999${index}`,
        occurredAt: `2026-06-03T13:0${index}:00.000Z`,
        contentText: `Meeting note ${index}`,
        contentAudioUrl: index === 0 ? 'teams/team-1/meeting/older-audio.m4a' : null,
      }),
    );
    const olderAudioEvent = events[0];
    if (!olderAudioEvent) throw new Error('Expected generated timeline event.');

    render(
      createElement(TimelineList, {
        events,
        authorMap: new Map(),
        audioUrlMap: new Map([[olderAudioEvent.id, '/audio/older-audio.m4a']]),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Meeting note 8/i }));
    const inspector = renderLastInspector();
    expect(inspector).toContain('Meeting note 8');
    expect(inspector).not.toContain('Meeting note 0');
    expect(inspector).toContain('+ 1 older evidence item');
    expect(inspector).toContain('/audio/older-audio.m4a');
  });

  it('opens long source evidence in a quick-view dialog from the inspector', async () => {
    const longUrl =
      'https://example.com/integrations/github/actions/runs/1234567890/jobs/9876543210?check_suite_focus=true&veryLongReference=timeline-source-evidence';
    const longBody = [
      'Incident report for Apple Pay checkout.',
      'The provider payload includes enough structured context to be useful but too much to read inline.',
      longUrl,
      'Affected storefront: EU production checkout.',
      'Status: resolved after the deployment finished.',
      'Follow-up: watch payment declines tomorrow morning.',
      'Additional raw payload metadata that should live in the quick-view instead of expanding the source card.',
    ].join('\n');

    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: '16161616-1616-4161-8161-161616161616',
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'integration',
            contentText: longBody,
            sourceMetadata: {
              provider: 'github',
              event: 'workflow_run.success',
              external_object_id: 'github:workflow:1234567890',
            },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Incident report for Apple Pay/i }));
    renderLastInspectorContent();

    fireEvent.click(screen.getByRole('button', { name: 'View full evidence' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Source evidence' })).toBeTruthy();
    expect(within(dialog).getByText((content) => content.includes(longUrl))).toBeTruthy();
  });

  it('does not show a quick-view button for short source evidence', () => {
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: '17171717-1717-4171-8171-171717171717',
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'telegram',
            contentText: 'Short source note.',
            sourceMetadata: { tg_chat_title: 'AuditAI', tg_sender_name: 'Tim' },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Short source note/i }));
    renderLastInspectorContent();

    expect(screen.queryByRole('button', { name: 'View full evidence' })).toBeNull();
  });
});

describe('TimelineList related evidence bundles', () => {
  it('keeps related signals quiet on the row and detailed in the inspector', () => {
    const reportId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const mergedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: reportId,
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'telegram',
            contentText: 'Checkout crashes on Apple Pay.',
            sourceMetadata: { tg_chat_title: 'Support', tg_sender_name: 'Maya' },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
        artifactClustersByEventId: {
          [reportId]: {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            artifactType: 'task',
            canonicalName: 'Apple Pay checkout crash',
            status: 'resolved',
            relatedEvidence: [
              {
                rawEventId: reportId,
                source: 'telegram',
                provider: 'telegram',
                externalObjectId: 'support-thread',
                role: 'report',
                strength: 'human',
                authoritative: false,
                occurredAt: '2026-06-03T13:04:00.000Z',
                snippet: 'Checkout crashes on Apple Pay.',
              },
              {
                rawEventId: mergedId,
                source: 'integration',
                provider: 'github',
                externalObjectId: 'timeline#44',
                role: 'lifecycle_update',
                strength: 'provider',
                authoritative: true,
                occurredAt: '2026-06-03T15:04:00.000Z',
                snippet: 'Merged fix for Apple Pay checkout crash.',
              },
            ],
          },
        },
      }),
    );

    expect(screen.getByText(/Related · Apple Pay checkout crash · 2 signals/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Checkout crashes on Apple Pay/i }));
    const inspector = renderLastInspector();
    expectTextOrder(inspector, 'Source evidence', 'Related evidence');
    expect(inspector).toContain('Related evidence');
    expect(inspector).toContain('Apple Pay checkout crash');
    expect(inspector).toContain('Task · Resolved · 2 signals');
    expect(inspector).toContain('1 status source');
    expect(inspector).toContain('Telegram · Report');
    expect(inspector).toContain('Github · Lifecycle Update');
    expect(inspector).toContain(`/app/timeline?event=${mergedId}#ev-${mergedId}`);
  });
});

describe('TimelineList audio transcription status', () => {
  it('shows pending transcription status even when an audio event has typed note text', () => {
    const html = renderTimeline([
      timelineEvent({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'web',
        contentText: "Today's Nexia meetings voice recording",
        contentAudioUrl: 'teams/team-1/web/user-1/voice.m4a',
        sourceMetadata: {
          audio_note_text: "Today's Nexia meetings voice recording",
        },
      }),
    ]);

    expect(html).toContain('Today&#x27;s Nexia meetings voice recording');
    expect(html).toContain('Transcribing…');
  });

  it('shows failed transcription status even when an audio event has typed note text', () => {
    const html = renderTimeline([
      timelineEvent({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'web',
        contentText: "Today's Nexia meetings voice recording",
        contentAudioUrl: 'teams/team-1/web/user-1/voice.m4a',
        sourceMetadata: {
          audio_note_text: "Today's Nexia meetings voice recording",
          transcription_failed_at: '2026-06-03T13:05:00.000Z',
        },
      }),
    ]);

    expect(html).toContain('Today&#x27;s Nexia meetings voice recording');
    expect(html).toContain('Transcription failed; voice memo is still playable.');
  });

  it('hides transcription status once an audio event has been transcribed', () => {
    const html = renderTimeline([
      timelineEvent({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'web',
        contentText: "Today's Nexia meetings voice recording\n\nTranscript text.",
        contentAudioUrl: 'teams/team-1/web/user-1/voice.m4a',
        sourceMetadata: {
          audio_note_text: "Today's Nexia meetings voice recording",
          transcribed_at: '2026-06-03T13:05:00.000Z',
        },
      }),
    ]);

    expect(html).toContain('Transcript text.');
    expect(html).not.toContain('Transcribing…');
    expect(html).not.toContain('Transcription failed');
  });
});
