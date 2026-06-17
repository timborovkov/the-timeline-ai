// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactQuery from '@tanstack/react-query';

const fakes = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return {
    ...actual,
    useQuery: () => ({ data: { query: '', results: [] } }),
  };
});
vi.mock('@/app/actions/objects', () => ({
  acceptObjectChangeAction: vi.fn(),
  addRelationshipAction: vi.fn(),
  archiveObjectAction: vi.fn(),
  createNoteAction: vi.fn(),
  deleteNoteAction: vi.fn(),
  rejectObjectChangeAction: vi.fn(),
  removeRelationshipAction: vi.fn(),
  repairObjectMemoryAction: vi.fn(),
  updateNoteAction: vi.fn(),
  updateObjectAction: vi.fn(),
}));
vi.mock('@/app/actions/suggestions', () => ({
  acceptAllSuggestionAction: vi.fn(),
  acceptSuggestionItemAction: vi.fn(),
  rejectSuggestionItemAction: vi.fn(),
}));
vi.mock('@/components/objects/object-section-feed', () => ({
  ObjectSectionFeed: ({ title }: { title: string }) => title,
}));

const { ObjectDetailClient } = await import('./object-detail-client.js');
const { visibleObjectSearchResultsForQuery } = await import('./object-search-results.js');
const objectActions = await import('@/app/actions/objects');

const detail = {
  id: 'object-1',
  teamId: 'team-1',
  type: 'task',
  canonicalName: 'Send proposal',
  aliases: [],
  metadata: {},
  status: 'todo',
  stage: 'proposal',
  priority: 2,
  ownerUserId: 'user-1',
  assigneeUserId: null,
  dueAt: new Date('2026-06-05T12:00:00.000Z'),
  sourceEventId: null,
  agentSuggested: false,
  archivedAt: null,
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
  notes: [],
  relationships: [],
  relatedObjects: [],
  openTasks: [],
  connectedWork: {
    openTasks: [],
    recentTasks: [],
    calendarEvents: [],
    timelineEvents: [],
    objects: [],
    boards: [],
    pendingApprovals: [],
    documents: [],
  },
  recentChanges: [],
  facts: [],
  timelineEvents: [],
  newSinceLastVisit: 0,
  lastVisitedAt: null,
} as Parameters<typeof ObjectDetailClient>[0]['detail'];

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(objectActions.updateObjectAction).mockResolvedValue({ ok: true, id: detail.id });
  vi.mocked(objectActions.repairObjectMemoryAction).mockResolvedValue({
    ok: true,
    message: 'Memory repair queued',
  });
});

function renderObjectDetail(props: Parameters<typeof ObjectDetailClient>[0]): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ObjectDetailClient, props),
    ),
  );
}

function objectDetailElement(props: Parameters<typeof ObjectDetailClient>[0]) {
  const queryClient = new QueryClient();
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ObjectDetailClient, props),
  );
}

describe('ObjectDetailClient', () => {
  it('renders object detail sections and archive control', () => {
    const html = renderObjectDetail({ detail, userId: 'user-1', suggestions: [] });

    expect(html).toContain('Send proposal');
    expect(html).toContain('Notes');
    expect(html).toContain('Connected work');
    expect(html).toContain('Related');
    expect(html).toContain('Search objects');
    expect(html).not.toContain('Object id');
    expect(html).not.toContain('value="linked"');
    expect(html).toContain('Recent changes');
    expect(html).toContain('Archive object');
  });

  it('renders pending approvals on the object detail surface', () => {
    const html = renderObjectDetail({
      detail,
      userId: 'user-1',
      suggestions: [
        {
          id: 'bundle-1',
          source: 'background',
          status: 'pending',
          title: 'Update proposal stage',
          summary: null,
          reason: null,
          confidence: 'medium',
          createdAt: '2026-06-01T10:00:00.000Z',
          evidence: [],
          items: [
            {
              id: 'item-1',
              status: 'pending',
              operation: 'update',
              targetKind: 'object',
              targetId: 'object-1',
              title: 'Move to proposal',
              description: null,
              proposedPayload: { stage: 'proposal' },
              failureReason: null,
            },
            {
              id: 'item-2',
              status: 'failed',
              operation: 'create',
              targetKind: 'task',
              targetId: null,
              title: 'Create follow-up task',
              description: null,
              proposedPayload: { title: 'Follow up' },
              failureReason: 'temporary failure',
            },
          ],
        },
      ],
    });

    expect(html).toContain('Pending approvals');
    expect(html).toContain('2 waiting');
    expect(html).toContain('Update proposal stage');
    expect(html).toContain('Move to proposal');
  });

  it('renders connected work grouped by active and historical context', () => {
    const html = renderObjectDetail({
      detail: {
        ...detail,
        connectedWork: {
          openTasks: [
            {
              ...detail,
              id: 'task-1',
              type: 'task',
              canonicalName: 'Send message to DFK with proposed meeting times',
              status: 'todo',
            },
          ],
          recentTasks: [
            {
              ...detail,
              id: 'task-2',
              type: 'task',
              canonicalName: 'Send pilot times to DFK',
              status: 'done',
            },
          ],
          calendarEvents: [
            {
              id: 'calendar-1',
              title: 'Meeting with DFK Finland Oy',
              startAt: new Date('2026-06-17T12:00:00.000Z'),
              endAt: new Date('2026-06-17T13:00:00.000Z'),
              showAs: 'busy',
            },
          ],
          timelineEvents: [
            {
              id: 'event-1',
              source: 'web',
              contentText: 'Jonne from DFK discussed the pilot scope.',
              occurredAt: new Date('2026-06-16T10:00:00.000Z'),
            },
          ],
          objects: [
            {
              id: 'person-1',
              canonicalName: 'Jonne Granqvist',
              type: 'person',
              factCount: 2,
            },
          ],
          boards: [
            {
              boardId: 'board-1',
              boardName: 'Pilot pipeline',
              itemId: 'item-1',
              laneName: 'Proposal',
              dueAt: null,
              priority: null,
              nextStep: 'Agree pilot scope',
            },
          ],
          pendingApprovals: [
            {
              suggestionId: 'suggestion-1',
              itemId: 'approval-item-1',
              title: 'Merge DFK Finland Oy into DFK',
              operation: 'merge',
              targetKind: 'object_merge',
              createdAt: new Date('2026-06-16T10:00:00.000Z'),
            },
          ],
          documents: [
            {
              id: 'document-1',
              name: 'DFK pilot deck.pdf',
              fileKind: 'document',
              updatedAt: new Date('2026-06-16T11:00:00.000Z'),
            },
          ],
        },
      },
      userId: 'user-1',
      suggestions: [],
    });

    expect(html).toContain('Send message to DFK with proposed meeting times');
    expect(html).toContain('Meeting with DFK Finland Oy');
    expect(html).toContain('Jonne from DFK discussed the pilot scope.');
    expect(html).toContain('Jonne Granqvist');
    expect(html).toContain('Pilot pipeline');
    expect(html).toContain('Merge DFK Finland Oy into DFK');
    expect(html).toContain('Send pilot times to DFK');
    expect(html).toContain('DFK pilot deck.pdf');
  });

  it('shows connected open tasks once on the object detail page', () => {
    const taskTitle = 'Send message to DFK with proposed meeting times';
    const html = renderObjectDetail({
      detail: {
        ...detail,
        openTasks: [
          {
            ...detail,
            id: 'task-1',
            type: 'task',
            canonicalName: taskTitle,
            status: 'todo',
          },
        ],
        connectedWork: {
          ...detail.connectedWork,
          openTasks: [
            {
              ...detail,
              id: 'task-1',
              type: 'task',
              canonicalName: taskTitle,
              status: 'todo',
            },
          ],
        },
      },
      userId: 'user-1',
      suggestions: [],
    });

    expect(html.match(new RegExp(taskTitle, 'g'))).toHaveLength(1);
  });

  it('edits the object name and aliases from the fields panel', async () => {
    const user = userEvent.setup();
    render(objectDetailElement({ detail, userId: 'user-1', suggestions: [] }));

    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Send renewed proposal');
    await user.tab();

    await waitFor(() => {
      expect(objectActions.updateObjectAction).toHaveBeenCalledWith({
        id: detail.id,
        canonicalName: 'Send renewed proposal',
      });
    });

    const aliasesInput = screen.getByLabelText('Aliases');
    await user.type(aliasesInput, 'Proposal task, Send renewed proposal, Proposal task');
    await user.tab();

    await waitFor(() => {
      expect(objectActions.updateObjectAction).toHaveBeenCalledWith({
        id: detail.id,
        aliases: ['Proposal task'],
      });
    });
  });

  it('queues object-scoped memory repair from the header', async () => {
    const user = userEvent.setup();
    render(objectDetailElement({ detail, userId: 'user-1', suggestions: [] }));

    await user.click(screen.getByRole('button', { name: 'Repair memory' }));

    await waitFor(() => {
      expect(objectActions.repairObjectMemoryAction).toHaveBeenCalledWith({ id: detail.id });
    });
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('disables memory repair for archived objects', async () => {
    const user = userEvent.setup();
    render(
      objectDetailElement({
        detail: {
          ...detail,
          archivedAt: new Date('2026-06-02T10:00:00.000Z'),
        },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    const repairButton = screen.getByRole('button', { name: 'Repair unavailable' });
    expect(repairButton).toHaveProperty('disabled', true);
    await user.click(repairButton);

    expect(objectActions.repairObjectMemoryAction).not.toHaveBeenCalled();
  });

  it('applies refreshed server detail props without requiring updatedAt to change', async () => {
    const refreshedDetail = {
      ...detail,
      archivedAt: '2026-06-02T10:00:00.000Z',
      notes: [
        {
          id: 'note-1',
          body: 'Server note',
          authorUserId: 'user-1',
          createdAt: new Date('2026-06-02T09:00:00.000Z'),
          updatedAt: new Date('2026-06-02T09:00:00.000Z'),
        },
      ],
      relationships: [
        {
          id: 'relationship-1',
          direction: 'out',
          kind: 'related',
          otherId: 'object-2',
          otherName: 'Acme',
          otherType: 'company',
        },
      ],
      recentChanges: [
        {
          id: 'change-1',
          field: 'stage',
          previousValue: 'proposal',
          newValue: 'done',
          actorKind: 'user',
          confidence: 'high',
          status: 'applied',
          changedAt: new Date('2026-06-02T09:30:00.000Z'),
          evidence: [],
        },
      ],
    } as never;
    const { rerender } = render(objectDetailElement({ detail, userId: 'user-1', suggestions: [] }));

    expect(screen.queryByText('Server note')).toBeNull();

    rerender(objectDetailElement({ detail: refreshedDetail, userId: 'user-1', suggestions: [] }));

    await waitFor(() => {
      expect(screen.getByText('Server note')).toBeTruthy();
      expect(screen.getByText('Acme')).toBeTruthy();
      expect(screen.getByText('Archived')).toBeTruthy();
      expect(screen.getByText('Recent changes')).toBeTruthy();
    });
  });

  it('preserves local form state when refreshed server props change updatedAt', async () => {
    const user = userEvent.setup();
    const refreshedDetail = {
      ...detail,
      updatedAt: new Date('2026-06-01T10:01:00.000Z'),
    };
    const { rerender } = render(objectDetailElement({ detail, userId: 'user-1', suggestions: [] }));

    const noteInput = screen.getByLabelText('New note');
    await user.type(noteInput, 'Draft survives refresh');

    rerender(objectDetailElement({ detail: refreshedDetail, userId: 'user-1', suggestions: [] }));

    expect(screen.getByDisplayValue('Draft survives refresh')).toBeTruthy();
  });

  it('filters placeholder object search results against the current query', () => {
    const staleData = {
      query: 'Acme',
      results: [{ id: 'object-2', canonicalName: 'Acme Renewal', type: 'deal' }],
    };

    expect(visibleObjectSearchResultsForQuery(staleData, 'Globex')).toEqual([]);
    expect(visibleObjectSearchResultsForQuery(staleData, 'Acm')).toEqual(staleData.results);
  });
});
