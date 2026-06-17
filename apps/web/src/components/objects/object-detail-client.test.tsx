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
  generateObjectSummaryAction: vi.fn(),
  rejectObjectChangeAction: vi.fn(),
  removeRelationshipAction: vi.fn(),
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
  recentChanges: [],
  facts: [],
  timelineEvents: [],
  summary: null,
  newSinceLastVisit: 0,
  lastVisitedAt: null,
} as Parameters<typeof ObjectDetailClient>[0]['detail'];

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(objectActions.updateObjectAction).mockResolvedValue({ ok: true, id: detail.id });
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
    expect(html).toContain('Open tasks');
    expect(html).toContain('Related');
    expect(html).toContain('Search objects');
    expect(html).not.toContain('Object id');
    expect(html).not.toContain('value="linked"');
    expect(html).toContain('Recent changes');
    expect(html).toContain('Archive object');
  });

  it('uses source-tracked display titles for the object detail heading', () => {
    render(
      objectDetailElement({
        detail: {
          ...detail,
          canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
          metadata: {
            integration_provider: 'github',
            integration_external_id: 'timborovkov/the-timeline-ai#202',
            display_title: 'the-timeline-ai: Add cursor pagination',
            display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
          },
        },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'the-timeline-ai: Add cursor pagination' }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue('the-timeline-ai: Add cursor pagination')).toBeTruthy();
  });

  it('does not rename integration objects when the display title field is focused and blurred unchanged', async () => {
    const user = userEvent.setup();
    render(
      objectDetailElement({
        detail: {
          ...detail,
          canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
          metadata: {
            integration_provider: 'github',
            integration_external_id: 'timborovkov/the-timeline-ai#202',
            display_title: 'the-timeline-ai: Add cursor pagination',
            display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
          },
        },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    const nameInput = screen.getByLabelText('Name');
    await user.click(nameInput);
    await user.tab();

    expect(objectActions.updateObjectAction).not.toHaveBeenCalled();
  });

  it('uses source-tracked display titles for linked integration open tasks', () => {
    const html = renderObjectDetail({
      detail: {
        ...detail,
        openTasks: [
          {
            ...detail,
            id: 'task-2',
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            metadata: {
              integration_provider: 'github',
              integration_external_id: 'timborovkov/the-timeline-ai#202',
              display_title: 'the-timeline-ai: Add cursor pagination',
              display_title_canonical_name:
                'timborovkov/the-timeline-ai#202: Add cursor pagination',
            },
          },
        ],
      },
      userId: 'user-1',
      suggestions: [],
    });

    expect(html).toContain('the-timeline-ai: Add cursor pagination');
    expect(html).not.toContain('timborovkov/the-timeline-ai#202');
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

  it('renders object summaries above evidence', () => {
    const html = renderObjectDetail({
      detail: {
        ...detail,
        summary: {
          status: 'ready',
          summary: {
            overview: 'DFK has a confirmed June 30 pilot discussion.',
            overviewSourceRefs: [{ kind: 'fact', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
            currentState: [
              {
                label: 'Timing',
                text: 'The latest confirmed meeting date is June 30.',
                sourceRefs: [{ kind: 'fact', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
              },
            ],
            openQuestions: [],
            conflicts: [],
          },
          plainText: 'DFK has a confirmed June 30 pilot discussion.',
          sourceRefs: [{ kind: 'fact', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
          sourceCounts: {
            fields: 2,
            facts: 1,
            events: 1,
            notes: 0,
            relationships: 0,
            tasks: 0,
            changes: 0,
          },
          generatedAt: new Date('2026-06-16T10:00:00.000Z'),
          staleAt: null,
          lastAttemptedAt: new Date('2026-06-16T10:00:00.000Z'),
          lastErrorCode: null,
          canGenerate: true,
          cannotGenerateReason: null,
        },
      },
      userId: 'user-1',
      suggestions: [],
    });

    expect(html.indexOf('Summary')).toBeLessThan(html.indexOf('Evidence'));
    expect(html).toContain('DFK has a confirmed June 30 pilot discussion.');
    expect(html).toContain('Timing');
    expect(html).not.toContain('Generate summary');
  });

  it('shows manual generation for missing summaries with enough source material', () => {
    render(
      objectDetailElement({
        detail: {
          ...detail,
          summary: {
            status: 'missing',
            summary: null,
            plainText: '',
            sourceRefs: [],
            sourceCounts: {
              fields: 2,
              facts: 2,
              events: 1,
              notes: 0,
              relationships: 0,
              tasks: 0,
              changes: 0,
            },
            generatedAt: null,
            staleAt: null,
            lastAttemptedAt: null,
            lastErrorCode: null,
            canGenerate: true,
            cannotGenerateReason: null,
          },
        },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    expect(screen.getByText('Summary is ready to generate.')).toBeTruthy();
    expect(screen.getByText('Ready to generate')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate summary' })).toBeTruthy();
  });

  it('queues manual summary generation from the object page', async () => {
    const user = userEvent.setup();
    vi.mocked(objectActions.generateObjectSummaryAction).mockResolvedValue({
      ok: true,
      id: 'summary-job',
    });
    render(
      objectDetailElement({
        detail: {
          ...detail,
          summary: {
            status: 'failed',
            summary: null,
            plainText: '',
            sourceRefs: [],
            sourceCounts: {
              fields: 2,
              facts: 2,
              events: 1,
              notes: 0,
              relationships: 0,
              tasks: 0,
              changes: 0,
            },
            generatedAt: null,
            staleAt: null,
            lastAttemptedAt: new Date('2026-06-16T10:00:00.000Z'),
            lastErrorCode: 'provider_failed',
            canGenerate: true,
            cannotGenerateReason: null,
          },
        },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(objectActions.generateObjectSummaryAction).toHaveBeenCalledWith({
        entityId: detail.id,
      });
    });
    expect(fakes.refresh).toHaveBeenCalled();
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
