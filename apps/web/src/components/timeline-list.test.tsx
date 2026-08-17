// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TimelineEvent } from '@/lib/use-paginated-queries';
import type { ComponentProps, ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  showInspector: vi.fn(),
  hideInspector: vi.fn(),
  refresh: vi.fn(),
  removeConversationalEvent: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/app/actions/events', () => ({
  removeConversationalEventAction: fakes.removeConversationalEvent,
}));
vi.mock('@/components/documents/document-preview', () => ({
  DocumentPreview: () => createElement('button', { type: 'button' }, 'Preview'),
}));
vi.mock('@/components/event-visibility-form', () => ({
  EventVisibilityForm: ({
    onSaved,
  }: {
    onSaved?: (value: { visibility: string; visibilityUserIds: string[] }) => void;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => onSaved?.({ visibility: 'specific_users', visibilityUserIds: ['user-2'] }),
      },
      'Save test visibility',
    ),
}));
vi.mock('@/components/inspector-context', () => ({
  useInspector: () => ({
    open: false,
    content: null,
    show: fakes.showInspector,
    hide: fakes.hideInspector,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('sonner', () => ({ toast: { success: fakes.toastSuccess } }));

const { TimelineList } = await import('./timeline-list.js');

interface InspectorContentForTest {
  render: () => ReactNode;
}

afterEach(() => {
  cleanup();
  fakes.showInspector.mockClear();
  fakes.hideInspector.mockClear();
  fakes.refresh.mockClear();
  fakes.removeConversationalEvent.mockReset();
  fakes.toastSuccess.mockClear();
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
  authorUserId?: string | null;
  visibility?: TimelineEvent['visibility'];
  visibilityUserIds?: string[] | null;
  visibilityOwnerUserId?: string | null;
  sourceMetadata?: Record<string, unknown>;
}): TimelineEvent {
  return {
    id: input.id,
    teamId: 'team-1',
    authorUserId: input.authorUserId ?? null,
    source: input.source ?? 'meeting',
    contentText: input.contentText ?? 'Daily call notes',
    contentAudioUrl: input.contentAudioUrl ?? null,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    visibility: input.visibility ?? 'team',
    visibilityUserIds: input.visibilityUserIds ?? null,
    visibilityOwnerUserId: input.visibilityOwnerUserId ?? null,
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
    expect(html).toContain('shadow-[inset_2px_0_0_var(--signal)]');
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
    expect(html).toContain('shadow-[inset_2px_0_0_var(--signal)]');
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

    fireEvent.click(screen.getByRole('button', { name: /^Uploaded AgACAgQ/i }));
    const uploadInspector = renderLastInspector();
    expect(uploadInspector).toContain('Attachment · AgACAgQ…wADPAQ.jpg');
    expect(uploadInspector).toContain(`title="${generatedName}"`);
    expect(uploadInspector).toContain('Preview');

    fireEvent.click(screen.getByRole('button', { name: /^Renamed notes\.txt/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /^Attached image AgACAgQ/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /^Attached image AgACAgQ/i }));
    const inspector = renderLastInspector();
    expect(inspector).toContain('Attached image AgACAgQ…msbjOI.jpg');
    expect(inspector).not.toContain(
      'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
    );
  });
});

describe('TimelineList moment presentation', () => {
  it('renders CI pulses as one muted line and conversations as story rows', () => {
    const html = renderTimeline([
      timelineEvent({
        id: '19191919-1919-4191-8191-191919191919',
        occurredAt: '2026-06-03T13:10:00.000Z',
        source: 'integration',
        contentText: 'GitHub workflow "CI" #1603 on acme/app success',
        sourceMetadata: {
          provider: 'github',
          event_type: 'workflow_run.success',
          github: { type: 'workflow_run', repo: 'acme/app', head_branch: 'main' },
        },
      }),
      timelineEvent({
        id: '20202020-2020-4202-8202-202020202020',
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'telegram',
        contentText: 'Standup notes from Maya',
        sourceMetadata: { tg_chat_title: 'Engineering', tg_sender_name: 'Maya' },
      }),
    ]);

    expect(html).toContain('data-visual-weight="pulse"');
    expect(html).toContain('data-event-class="pulse"');
    expect(html).toContain('data-visual-weight="story"');
    expect(html).toContain('data-event-class="communication"');
    expect(html).toContain('CI passed on acme/app · main');
    expect(html).not.toContain('[ev:');
    expect(html).not.toContain('View evidence');
    expect(html).not.toContain('workflow_run:1603');
    expect(html).not.toContain('right-[-7px]');
    expect(html).not.toContain('w-px bg-border');
  });

  it('keeps All events as a uniform compact log', () => {
    const html = renderTimeline(
      [
        timelineEvent({
          id: '21212121-2121-4121-8121-212121212121',
          occurredAt: '2026-06-03T13:04:00.000Z',
          source: 'telegram',
          contentText: 'Standup notes from Maya',
          sourceMetadata: { tg_chat_title: 'Engineering', tg_sender_name: 'Maya' },
        }),
      ],
      { mode: 'events' },
    );

    expect(html).toContain('aria-label="All events"');
    expect(html).toContain('data-timeline-mode="events"');
    expect(html).toContain('data-visual-weight="pulse"');
  });

  it('keeps short actor names that only match part of the moment title', () => {
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: '18181818-1818-4181-8181-181818181818',
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'telegram',
            contentText: 'Timeline import completed',
            sourceMetadata: {
              tg_chat_id: 'chat-1',
              tg_chat_title: 'Operations',
              tg_sender_name: 'Tim',
              tg_user_id: 1,
            },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    expect(screen.getByText('Tim', { selector: 'span' })).toBeTruthy();
  });

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

    expect(screen.queryByText('View evidence · 1 signal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Done \/ 16\.20/i }));
    const inspector = renderLastInspector();
    expect(inspector).toContain('Source evidence');
    expect(inspector).toContain('[ev:14141414]');
    expect(inspector).toContain('Copy citation [ev:14141414]');
    expect(inspector).toContain('Technical details');
    expect(inspector).not.toContain('Evidence summary');
    expect(inspector).not.toContain('1 evidence item');
    expect(inspector).not.toContain('Why this row exists');
    expect(inspector).not.toContain('Source truth');
    expect(inspector).not.toContain('1 source event');
  });

  it('keeps evidence-owned controls inside the source card before technical details', () => {
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
    expectTextOrder(inspector, 'Source evidence', 'Audio for Meeting evidence');
    expectTextOrder(inspector, 'Audio for Meeting evidence', 'Technical details');
    expect(inspector).not.toContain('>Controls<');
  });
});

describe('TimelineList evidence-owned actions', () => {
  it('gives five same-minute Telegram events one matching footer each with no global controls', async () => {
    const user = userEvent.setup();
    const events = Array.from({ length: 5 }, (_, index) =>
      timelineEvent({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
        occurredAt: `2026-08-04T12:35:${String(index).padStart(2, '0')}.000Z`,
        source: 'telegram',
        contentText: `Telegram message ${index}`,
        authorUserId: 'user-1',
        visibilityOwnerUserId: 'user-1',
        visibility: index === 1 ? 'private' : index === 2 ? 'specific_users' : 'team',
        visibilityUserIds: index === 2 ? ['user-2', 'user-3'] : null,
        contentAudioUrl: index === 3 || index === 4 ? `audio-${index}.m4a` : null,
        sourceMetadata: {
          tg_chat_id: 'audit-ai',
          tg_message_id: 100 + index,
          tg_chat_title: 'AuditAI',
          tg_sender_name: 'Mikael',
        },
      }),
    );
    const playable = events[3];
    if (!playable) throw new Error('Expected playable Telegram evidence.');

    render(
      <TimelineList
        events={events}
        authorMap={new Map()}
        audioUrlMap={new Map([[playable.id, '/audio/telegram-message.m4a']])}
        currentUserId="user-1"
        isAdmin={false}
        members={[
          { id: 'user-2', label: 'Alex' },
          { id: 'user-3', label: 'Sam' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Telegram message 4 ·/i }));
    renderLastInspectorContent();

    expect(
      screen.getAllByRole('group', { name: /Actions for Telegram evidence .* from Mikael/ }),
    ).toHaveLength(5);
    expect(screen.queryByRole('heading', { name: 'Controls' })).toBeNull();
    expect(screen.getAllByText('Team visibility')).toHaveLength(3);
    expect(screen.getByText('Private', { selector: 'summary' })).toBeTruthy();
    expect(screen.getByText('Specific people · 2')).toBeTruthy();
    expect(
      screen
        .getByLabelText(/Audio for Telegram evidence “Telegram message 3”/i)
        .getAttribute('src'),
    ).toBe('/audio/telegram-message.m4a');
    expect(screen.getByText('Audio unavailable for this evidence item.')).toBeTruthy();

    const firstFooter = screen.getAllByRole('group', {
      name: /Actions for Telegram evidence .* from Mikael/,
    })[0];
    if (!firstFooter) throw new Error('Expected the first evidence footer.');
    await user.click(within(firstFooter).getByText('Team visibility'));
    await user.click(within(firstFooter).getByRole('button', { name: 'Save test visibility' }));
    expect(within(firstFooter).getByText('Specific people · 1')).toBeTruthy();
  });

  it('confirms removal, retains retryable failures, then closes and refreshes on success', async () => {
    const user = userEvent.setup();
    const event = timelineEvent({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      occurredAt: '2026-08-04T12:35:00.000Z',
      source: 'slack',
      contentText: 'Remove this captured message',
      authorUserId: 'user-1',
      visibilityOwnerUserId: 'user-1',
      sourceMetadata: {
        slack_workspace_id: 'workspace-1',
        slack_channel_id: 'channel-1',
        slack_message_ts: '123.456',
        slack_sender_name: 'Mikael',
      },
    });

    render(
      <TimelineList
        events={[event]}
        authorMap={new Map()}
        currentUserId="user-1"
        isAdmin={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Remove this captured message/i }));
    renderLastInspectorContent();

    const openRemoval = async () => {
      await user.click(screen.getByRole('button', { name: /Actions for Slack evidence/ }));
      await user.click(await screen.findByRole('menuitem', { name: 'Remove evidence' }));
    };

    await openRemoval();
    expect(
      screen.getByText(
        /tombstone this captured Telegram or Slack message and all stored revisions/i,
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep evidence' }));
    expect(fakes.removeConversationalEvent).not.toHaveBeenCalled();

    fakes.removeConversationalEvent.mockResolvedValueOnce({ error: 'Removal failed' });
    await openRemoval();
    await user.click(screen.getByRole('button', { name: 'Remove evidence' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Removal failed');
    });
    expect(fakes.hideInspector).not.toHaveBeenCalled();

    fakes.removeConversationalEvent.mockResolvedValueOnce({ ok: true });
    await openRemoval();
    await user.click(screen.getByRole('button', { name: 'Remove evidence' }));
    await waitFor(() => {
      expect(fakes.hideInspector).toHaveBeenCalledTimes(1);
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
      expect(fakes.toastSuccess).toHaveBeenCalledWith('Evidence removed from Timeline');
    });
  });
});

describe('TimelineList inspector source caps', () => {
  it('reveals older source evidence in batches without exposing orphaned controls', () => {
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
    renderLastInspectorContent();
    expect(screen.getAllByText('Meeting note 8').length).toBeGreaterThan(0);
    expect(screen.queryByText('Meeting note 0')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show 1 older evidence item' })).toBeTruthy();
    expect(screen.queryByLabelText(/Audio for Meeting evidence.*4:00 PM/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 older evidence item' }));

    expect(screen.getByText('Meeting note 0')).toBeTruthy();
    expect(
      screen.getByLabelText(/Audio for Meeting evidence.*Meeting note 0/i).getAttribute('src'),
    ).toBe('/audio/older-audio.m4a');
    expect(screen.queryByRole('button', { name: /Show .* older evidence/ })).toBeNull();
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
            source: 'telegram',
            contentText: longBody,
            sourceMetadata: { tg_chat_title: 'AuditAI', tg_sender_name: 'Tim' },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: /^Incident report for Apple Pay checkout/i }),
    );
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

    fireEvent.click(screen.getByRole('button', { name: /^Short source note/i }));
    renderLastInspectorContent();

    expect(screen.queryByRole('button', { name: 'View full evidence' })).toBeNull();
  });

  it('keeps original email HTML behind a collapsed inspector disclosure', () => {
    render(
      createElement(TimelineList, {
        events: [
          timelineEvent({
            id: '19191919-1919-4191-8191-191919191918',
            occurredAt: '2026-06-03T13:04:00.000Z',
            source: 'email',
            contentText: 'Please review the appendix.',
            sourceMetadata: {
              subject: 'Vendor contract review',
              html_body: '<p>Please review the <b>appendix</b>.</p>',
              source_snapshot: {
                provider: 'postmark',
                subject: 'Vendor contract review',
                html_body: '<p>Please review the <b>appendix</b>.</p>',
                from: { email: 'mika@example.com' },
              },
            },
          }),
        ],
        authorMap: new Map(),
        currentUserId: 'user-1',
        isAdmin: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /^Vendor contract review/i }));
    const inspector = renderLastInspector();
    expect(inspector).toContain('Original email');
    expect(inspector).toContain('sandbox=""');
    expect(inspector).toContain('Please review the &lt;b&gt;appendix&lt;/b&gt;.');
    expect(inspector).not.toContain('sha256:deadbeef');
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
                associationSource: 'human',
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
                associationSource: 'authoritative_provider',
                authoritative: true,
                occurredAt: '2026-06-03T15:04:00.000Z',
                snippet: 'Merged fix for Apple Pay checkout crash.',
              },
            ],
          },
        },
      }),
    );

    expect(screen.queryByText(/Related · Apple Pay checkout crash · 2 signals/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Checkout crashes on Apple Pay/i }));
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
