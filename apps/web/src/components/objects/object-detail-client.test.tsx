// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactQuery from '@tanstack/react-query';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadTaskCategoryStatesAction: vi.fn(),
}));

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
  loadTaskCategoryStatesAction: fakes.loadTaskCategoryStatesAction,
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
  taskCategory: null,
  taskCategoryMode: null,
  taskCategorySource: null,
  taskCategoryStatus: null,
  taskCategoryUpdatedAt: null,
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
    links: [],
    capturedFiles: [],
  },
  provenance: {
    whyThisExists: [],
    whatChangedIt: [],
    relatedEvidence: [],
  },
  recentChanges: [],
  identityFacets: [],
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
  vi.mocked(objectActions.repairObjectMemoryAction).mockResolvedValue({
    ok: true,
    message: 'Memory repair queued',
  });
  fakes.loadTaskCategoryStatesAction.mockResolvedValue({ rows: [] });
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

  it('renders task category snapshots as readable recent changes', () => {
    const html = renderObjectDetail({
      detail: {
        ...detail,
        recentChanges: [
          {
            id: 'category-change-1',
            field: 'taskCategory',
            previousValue: {
              category: 'design',
              mode: 'automatic',
              source: 'llm',
              status: 'ready',
              appliedInputHash: 'old-hash',
              requestedInputHash: null,
              taxonomyVersion: 'task-categories-v1',
            },
            newValue: {
              category: 'engineering',
              mode: 'manual',
              source: 'user',
              status: 'ready',
              appliedInputHash: null,
              requestedInputHash: null,
              taxonomyVersion: 'task-categories-v1',
            },
            actorKind: 'user',
            actorUserId: 'user-1',
            status: 'applied',
            note: null,
            changedAt: new Date('2026-07-14T09:00:00.000Z'),
          },
        ],
      },
      userId: 'user-1',
      suggestions: [],
    });

    expect(html).toContain('Category');
    expect(html).toContain('Design');
    expect(html).toContain('Engineering');
    expect(html).not.toContain('updated details');
  });

  it('does not render the task category field while the category UI is disabled', () => {
    render(
      objectDetailElement({
        detail,
        userId: 'user-1',
        suggestions: [],
        taskCategoriesEnabled: false,
      }),
    );

    expect(screen.queryByText('Category')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Task category' })).toBeNull();
  });

  it('updates the detail badge when pending classification completes', async () => {
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({
      rows: [
        {
          id: detail.id,
          taskCategory: 'design',
          taskCategoryMode: 'automatic',
          taskCategorySource: 'llm',
          taskCategoryStatus: 'ready',
          taskCategoryUpdatedAt: new Date('2026-07-13T10:00:00.000Z'),
        },
      ],
    });
    render(
      objectDetailElement({
        detail: { ...detail, taskCategoryStatus: 'pending' },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    await waitFor(() => {
      expect(screen.getByTitle('Design')).toBeTruthy();
    });
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
        connectedWork: {
          ...detail.connectedWork,
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
              name: 'AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg',
              fileKind: 'document',
              updatedAt: new Date('2026-06-16T11:00:00.000Z'),
            },
          ],
          links: [
            {
              id: 'link-1',
              canonicalName: 'example.com/dfk',
              canonicalUrl: 'https://example.com/dfk',
              displayUrl: 'example.com/dfk',
              domain: 'example.com',
              provider: null,
              updatedAt: new Date('2026-06-16T11:00:00.000Z'),
            },
          ],
          capturedFiles: [
            {
              id: 'file-1',
              name: 'pilot-photo.png',
              contentType: 'image/png',
              sourceRawEventId: 'event-1',
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
    expect(html).not.toContain('Jonne from DFK discussed the pilot scope.');
    expect(html).not.toContain('Timeline moments');
    expect(html).toContain('Jonne Granqvist');
    expect(html).toContain('Pilot pipeline');
    expect(html).toContain('Merge DFK Finland Oy into DFK');
    expect(html).toContain('Send pilot times to DFK');
    expect(html).toContain('example.com/dfk');
    expect(html).toContain('pilot-photo.png');
    expect(html).toContain('AgACAgQ…wADPAQ.jpg');
    expect(html).toContain(
      'title="AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg"',
    );
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

  it('renders saved contact facets for people', () => {
    const html = renderObjectDetail({
      detail: {
        ...detail,
        type: 'person',
        canonicalName: 'Ada Lovelace',
        identityFacets: [
          {
            id: 'facet-email',
            entityId: 'object-1',
            kind: 'email',
            value: 'ada@example.com',
            normalizedValue: 'ada@example.com',
            provider: null,
            externalId: null,
            linkedUserId: null,
          },
          {
            id: 'facet-phone',
            entityId: 'object-1',
            kind: 'phone',
            value: '+1 213 373 4253',
            normalizedValue: '+12133734253',
            provider: null,
            externalId: null,
            linkedUserId: null,
          },
        ],
      },
      userId: 'user-1',
      suggestions: [],
    });

    expect(html).toContain('Contact');
    expect(html).toContain('ada@example.com');
    expect(html).toContain('href="mailto:ada@example.com"');
    expect(html).toContain('href="tel:+12133734253"');
  });

  it('renders object summaries and provenance above evidence', () => {
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

    expect(html.indexOf('Summary')).toBeLessThan(html.indexOf('Provenance'));
    expect(html.indexOf('Provenance')).toBeLessThan(html.indexOf('Connected work'));
    expect(html.indexOf('Summary')).toBeLessThan(html.indexOf('Evidence'));
    expect(html).toContain('DFK has a confirmed June 30 pilot discussion.');
    expect(html).toContain('Timing');
    expect(html).not.toContain('Generate summary');
  });

  it('renders accepted source provenance for generated tasks', () => {
    const sourceEventId = '33333333-3333-4333-8333-333333333333';
    const html = renderObjectDetail({
      detail: {
        ...detail,
        canonicalName: 'Research tilintarkastusyhteisö founding process',
        provenance: {
          whyThisExists: [
            {
              id: 'suggestion-item-1',
              title: 'Research tilintarkastusyhteisö founding process',
              reason: 'Mikael asked for this from the Telegram discussion.',
              operation: 'create',
              targetKind: 'task',
              createdAt: new Date('2026-06-25T19:08:00.000Z'),
              evidence: [
                {
                  rawEventId: sourceEventId,
                  source: 'telegram',
                  contentText: 'Research the founding process and use the screenshots.',
                  quote: 'Research the founding process',
                  occurredAt: new Date('2026-06-25T19:05:00.000Z'),
                },
              ],
            },
          ],
          whatChangedIt: [],
          relatedEvidence: [],
        },
      },
      userId: 'user-1',
      suggestions: [],
    });

    expect(html).toContain('Provenance');
    expect(html).toContain('Why this exists');
    expect(html).toContain('Mikael asked for this from the Telegram discussion.');
    expect(html).toContain('telegram');
    expect(html).toContain(`/app/timeline?event=${sourceEventId}#ev-${sourceEventId}`);
  });

  it('keeps large provenance bundles compact while preserving source access', async () => {
    const user = userEvent.setup();
    const longBody = `GitHub evidence ${'multi-kilobyte payload '.repeat(180)}`;
    const provenanceEntry = (
      id: string,
      sources: string[],
      operation: string,
      title = `${id} title`,
      minute = 0,
    ) => ({
      id,
      title,
      reason: `${id} reason`,
      operation,
      targetKind: operation === 'observed' ? 'raw_event' : 'task',
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
      evidence: sources.map((source, index) => ({
        rawEventId: `event-${id}-${index}`,
        source,
        contentText: longBody,
        quote: null,
        occurredAt: new Date(`2026-07-10T09:${String(minute + index).padStart(2, '0')}:00.000Z`),
      })),
    });
    render(
      objectDetailElement({
        detail: {
          ...detail,
          provenance: {
            whyThisExists: [provenanceEntry('creation', ['creation', 'creation'], 'create')],
            whatChangedIt: Array.from({ length: 4 }, (_, index) =>
              provenanceEntry(
                `change-${index}`,
                Array.from({ length: index < 2 ? 1 : 2 }, () => 'change'),
                'update',
                undefined,
                10 + index * 3,
              ),
            ),
            relatedEvidence: Array.from({ length: 8 }, (_, index) =>
              provenanceEntry(
                `related-${index}`,
                ['integration'],
                'observed',
                longBody,
                30 + index,
              ),
            ),
          },
        },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    expect(screen.getAllByText('2 sources')).toHaveLength(1);
    expect(screen.getAllByText('6 sources')).toHaveLength(1);
    expect(screen.getAllByText('8 sources')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /^creation ·/ })).toHaveLength(2);

    const changesDisclosure = screen.getByText('Review 4 more change sources');
    const relatedDisclosure = screen.getByText('Review 8 related sources');
    expect(changesDisclosure.closest('details')?.open).toBe(false);
    expect(relatedDisclosure.closest('details')?.open).toBe(false);
    expect(screen.getAllByRole('link', { name: /^change ·/ })[2]?.closest('details')).toBe(
      changesDisclosure.closest('details'),
    );
    const relatedLinks = screen.getAllByRole('link', { name: /^integration ·/ });
    expect(relatedLinks[0]?.closest('details')).toBe(relatedDisclosure.closest('details'));
    expect(new Set(relatedLinks.map((link) => link.textContent.trim())).size).toBe(8);

    await user.click(relatedDisclosure);

    expect(relatedDisclosure.closest('details')?.open).toBe(true);
    expect(screen.getAllByRole('link', { name: /^integration ·/ })).toHaveLength(8);
    expect(screen.queryByText(longBody)).toBeNull();
    expect(
      screen.getAllByText(/GitHub evidence multi-kilobyte payload/)[0]?.textContent.length,
    ).toBe(160);
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

  it('does not offer task creation from an archived project', () => {
    render(
      objectDetailElement({
        detail: {
          ...detail,
          type: 'project',
          canonicalName: 'Archived client project',
          archivedAt: new Date('2026-06-02T10:00:00.000Z'),
        },
        userId: 'user-1',
        suggestions: [],
      }),
    );

    expect(screen.queryByRole('link', { name: 'Add task' })).toBeNull();
  });

  it('does not offer the generic unlink action for a task primary project', () => {
    render(
      objectDetailElement({
        detail: {
          ...detail,
          relationships: [
            {
              id: 'relationship-project',
              direction: 'out',
              kind: 'child',
              otherId: 'project-1',
              otherName: 'Faba website redesign',
              otherType: 'project',
            },
          ],
        },
        userId: 'user-1',
        suggestions: [],
        primaryProject: {
          taskId: detail.id,
          projectId: 'project-1',
          projectName: 'Faba website redesign',
          archivedAt: null,
        },
      }),
    );

    expect(screen.getAllByText('Faba website redesign').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
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
