// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  acceptAllSuggestionAction: vi.fn(),
  acceptSuggestionItemAction: vi.fn(),
  acceptVisibleSuggestionsAction: vi.fn(),
  rejectSuggestionItemAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@/app/actions/suggestions', () => ({
  acceptAllSuggestionAction: fakes.acceptAllSuggestionAction,
  acceptSuggestionItemAction: fakes.acceptSuggestionItemAction,
  acceptVisibleSuggestionsAction: fakes.acceptVisibleSuggestionsAction,
  rejectSuggestionItemAction: fakes.rejectSuggestionItemAction,
}));

const { ApprovalsClient } = await import('./approvals-client.js');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.acceptAllSuggestionAction.mockResolvedValue({ ok: true });
  fakes.acceptSuggestionItemAction.mockResolvedValue({ ok: true });
  fakes.acceptVisibleSuggestionsAction.mockResolvedValue({ ok: true });
  fakes.rejectSuggestionItemAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ApprovalsClient', () => {
  it('renders the empty approval state', () => {
    const html = renderToStaticMarkup(createElement(ApprovalsClient, { suggestions: [] }));

    expect(html).toContain('No pending approvals');
    expect(html).toContain('Back to home');
  });

  it('renders actionable pending suggestions with evidence and accept controls', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Follow up with Acme',
            summary: 'A commitment was found.',
            reason: 'Timeline source evidence',
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [
              {
                rawEventId: EVENT_ID,
                quote: 'I will send the proposal',
                occurredAt: '2026-06-01T10:00:00.000Z',
                source: 'slack',
              },
            ],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send proposal',
                description: 'Send Acme the proposal.',
                proposedPayload: { canonicalName: 'Send proposal' },
                failureReason: null,
              },
              {
                id: 'item-2',
                status: 'failed',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Proposal meeting',
                description: null,
                proposedPayload: { title: 'Proposal meeting' },
                failureReason: 'Calendar conflict',
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Follow up with Acme');
    expect(html).toContain('Accept all');
    expect(html).toContain('Send proposal');
    expect(html).toContain('Calendar conflict');
    expect(html).toContain('I will send the proposal');
    expect(html).toContain('Timeline evidence · slack · 11111111');
    expect(html).toContain('create task');
  });

  it('opens evidence references with the full timeline event id', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          preview: {
            ref: { kind: 'timeline_event', id: EVENT_ID },
            title: 'Timeline Event',
            subtitle: 'slack · Jun 1, 2026',
            body: 'I will send the proposal',
            href: `/app/timeline?event=${EVENT_ID}#ev-${EVENT_ID}`,
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Follow up with Acme',
            summary: 'A commitment was found.',
            reason: 'Timeline source evidence',
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [
              {
                rawEventId: EVENT_ID,
                quote: 'I will send the proposal',
                occurredAt: '2026-06-01T10:00:00.000Z',
                source: 'slack',
              },
            ],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send proposal',
                description: 'Send Acme the proposal.',
                proposedPayload: { canonicalName: 'Send proposal' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    await userEvent.click(screen.getByText('Evidence · 1'));
    await userEvent.click(screen.getByRole('button', { name: /Timeline evidence · slack/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('expected evidence preview request');
    const [url, init] = call;
    if (!init) throw new Error('expected evidence preview request options');
    if (typeof init.body !== 'string') throw new Error('expected string request body');
    expect(url).toBe('/api/artifacts/preview');
    expect(JSON.parse(init.body)).toEqual({
      ref: { kind: 'timeline_event', id: EVENT_ID },
    });
    const fullPage = await screen.findByRole('link', { name: /Open full page/ });
    expect(fullPage.getAttribute('href')).toBe(`/app/timeline?event=${EVENT_ID}#ev-${EVENT_ID}`);
  });

  it('can hide bundle-level accept all for filtered approval surfaces', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        allowBulkAccept: false,
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Follow up with Acme',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send proposal',
                description: null,
                proposedPayload: { canonicalName: 'Send proposal' },
                failureReason: null,
              },
              {
                id: 'item-2',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Book review',
                description: null,
                proposedPayload: { canonicalName: 'Book review' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).not.toContain('Accept all');
    expect(html).toContain('Send proposal');
    expect(html).toContain('Book review');
  });

  it('renders a page-level accept all for multiple visible actionable bundles', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Follow up with Acme',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send proposal',
                description: null,
                proposedPayload: { canonicalName: 'Send proposal' },
                failureReason: null,
              },
            ],
          },
          {
            id: 'bundle-2',
            source: 'background',
            status: 'pending',
            title: 'Book review',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:05:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-2',
                status: 'failed',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Proposal meeting',
                description: null,
                proposedPayload: { title: 'Proposal meeting' },
                failureReason: 'Calendar conflict',
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Accept all visible');
    expect(html).toContain('Follow up with Acme');
    expect(html).toContain('Book review');
  });

  it('renders calendar-specific approval summaries and resolution hints', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-calendar',
            source: 'background',
            status: 'pending',
            title: 'Calendar cleanup',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-duplicate',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Nexia planning',
                description: null,
                proposedPayload: {
                  title: 'Nexia planning',
                  startAt: '2026-06-17T11:00:00.000Z',
                  endAt: '2026-06-17T12:00:00.000Z',
                  allDay: false,
                },
                calendarResolutionHint: {
                  kind: 'exact_duplicate_reuse',
                  event: {
                    id: '11111111-1111-4111-8111-111111111111',
                    title: 'Nexia planning',
                    description: null,
                    startAt: '2026-06-17T11:00:00.000Z',
                    endAt: '2026-06-17T12:00:00.000Z',
                    timezone: 'Europe/Helsinki',
                    allDay: false,
                    location: null,
                    showAs: 'busy',
                    visibility: 'team',
                    rrule: null,
                  },
                },
                failureReason: null,
              },
              {
                id: 'item-confirm',
                status: 'pending',
                operation: 'update',
                targetKind: 'calendar_event',
                targetId: '22222222-2222-4222-8222-222222222222',
                title: 'Confirm Acme slot',
                description: null,
                proposedPayload: {
                  proposalGroupId: 'acme-slots',
                  proposalRole: 'selected_slot',
                  proposalStatus: 'confirmed',
                  showAs: 'busy',
                },
                calendarResolutionHint: { kind: 'missing_target' },
                failureReason: null,
              },
              {
                id: 'item-target-move',
                status: 'pending',
                operation: 'update',
                targetKind: 'calendar_event',
                targetId: '33333333-3333-4333-8333-333333333333',
                title: 'Move Acme slot',
                description: null,
                proposedPayload: {
                  startAt: '2026-06-18T11:00:00.000Z',
                  endAt: '2026-06-18T12:00:00.000Z',
                  allDay: false,
                },
                calendarResolutionHint: {
                  kind: 'target_event',
                  event: {
                    id: '33333333-3333-4333-8333-333333333333',
                    title: 'Acme planning',
                    description: null,
                    startAt: '2026-06-17T11:00:00.000Z',
                    endAt: '2026-06-17T12:00:00.000Z',
                    timezone: 'Europe/Helsinki',
                    allDay: false,
                    location: null,
                    showAs: 'busy',
                    visibility: 'team',
                    rrule: null,
                  },
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Reuse existing');
    expect(html).toContain('Accept will reuse it instead of creating a duplicate');
    expect(html).toContain('Confirm slot');
    expect(html).toContain('Accepting one slot can cancel sibling tentative slots');
    expect(html).toContain('Proposed:');
  });

  it('does not show sibling cancellation copy for calendar proposal creates', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-calendar',
            source: 'background',
            status: 'pending',
            title: 'Create Acme slot holds',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-slot',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Proposed Acme meeting',
                description: null,
                proposedPayload: {
                  title: 'Proposed Acme meeting',
                  startAt: '2026-06-19T11:00:00.000Z',
                  endAt: '2026-06-19T11:30:00.000Z',
                  timezone: 'UTC',
                  visibility: 'team',
                  showAs: 'tentative',
                  proposalGroupId: 'acme-slots',
                  proposalStatus: 'tentative',
                  proposalRole: 'slot',
                },
                calendarResolutionHint: { kind: 'new_event' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Create');
    expect(html).not.toContain('Accepting one slot can cancel sibling tentative slots');
  });

  it('does not render page-level accept all for merge-only visible bundles', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Merge duplicate objects',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'merge',
                targetKind: 'object_merge',
                targetId: null,
                title: 'Merge Acme duplicates',
                description: null,
                proposedPayload: {
                  objectIds: [
                    '11111111-1111-4111-8111-111111111111',
                    '22222222-2222-4222-8222-222222222222',
                  ],
                  survivorId: '11111111-1111-4111-8111-111111111111',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).not.toContain('Accept all visible');
    expect(html).toContain('Review merge');
  });

  it('renders relationship bundle local refs as sibling object names', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Remember John and Acme',
            summary: null,
            reason: 'John was described as from Acme.',
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'create',
                targetKind: 'object',
                targetId: null,
                title: 'John Doe',
                description: null,
                proposedPayload: {
                  type: 'person',
                  canonicalName: 'John Doe',
                  localRef: 'John-Doe',
                },
                failureReason: null,
              },
              {
                id: 'item-2',
                status: 'pending',
                operation: 'create',
                targetKind: 'object',
                targetId: null,
                title: 'Acme Corporation',
                description: null,
                proposedPayload: {
                  type: 'company',
                  canonicalName: 'Acme Corporation',
                  localRef: 'acme',
                },
                failureReason: null,
              },
              {
                id: 'item-3',
                status: 'pending',
                operation: 'create',
                targetKind: 'object_relationship',
                targetId: null,
                title: 'Relate John Doe and Acme Corporation',
                description: null,
                proposedPayload: {
                  fromRef: 'john-doe',
                  toRef: 'acme',
                  kind: 'related',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('John Doe ↔ Acme Corporation · related');
    expect(html).toContain('create relationship');
    expect(html).not.toContain('fromRef');
    expect(html).not.toContain('localRef');
  });

  it('uses the item title for existing-object relationship summaries', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-existing-relationship',
            source: 'background',
            status: 'pending',
            title: 'Remember John Doe and Acme Corporation',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-existing-relationship',
                status: 'pending',
                operation: 'create',
                targetKind: 'object_relationship',
                targetId: null,
                title: 'Relate John Doe and Acme Corporation',
                description: null,
                proposedPayload: {
                  fromEntityId: '11111111-1111-4111-8111-111111111111',
                  toEntityId: '22222222-2222-4222-8222-222222222222',
                  kind: 'related',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Relate John Doe and Acme Corporation · related');
    expect(html).not.toContain('existing object ↔ existing object');
  });

  it('updates folded pending count after optimistic row removal', async () => {
    const user = userEvent.setup();

    const { getByRole, getByText } = render(
      createElement(ApprovalsClient, {
        folded: {
          title: 'Calendar approvals',
          summary: {
            singular: 'waiting',
            plural: 'waiting',
          },
          className: 'border-y border-border py-4',
        },
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Schedule follow-up',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Customer follow-up',
                description: null,
                proposedPayload: { title: 'Customer follow-up' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(getByText('1 waiting')).toBeTruthy();

    await user.click(getByRole('button', { name: /^Accept$/ }));

    await waitFor(() => {
      expect(getByText('0 waiting')).toBeTruthy();
    });
    expect(fakes.acceptSuggestionItemAction).toHaveBeenCalledWith({ itemId: 'item-1' });
  });

  it('keeps optimistic rows hidden across equivalent suggestion refreshes', async () => {
    const user = userEvent.setup();
    const suggestion = {
      id: 'bundle-1',
      source: 'background',
      status: 'pending',
      title: 'Schedule follow-up',
      summary: null,
      reason: null,
      confidence: 'high',
      createdAt: '2026-06-01T10:00:00.000Z',
      evidence: [],
      items: [
        {
          id: 'item-1',
          status: 'pending',
          operation: 'create',
          targetKind: 'calendar_event',
          targetId: null,
          title: 'Customer follow-up',
          description: null,
          proposedPayload: { title: 'Customer follow-up' },
          failureReason: null,
        },
      ],
    };

    const folded = {
      title: 'Calendar approvals',
      summary: {
        singular: 'waiting',
        plural: 'waiting',
      },
      className: 'border-y border-border py-4',
    };

    const { getByRole, getByText, rerender } = render(
      createElement(ApprovalsClient, {
        folded,
        suggestions: [suggestion],
      }),
    );

    await user.click(getByRole('button', { name: /^Accept$/ }));
    await waitFor(() => {
      expect(getByText('0 waiting')).toBeTruthy();
    });

    rerender(
      createElement(ApprovalsClient, {
        folded,
        suggestions: [{ ...suggestion, items: [...suggestion.items] }],
      }),
    );

    await waitFor(() => {
      expect(getByText('0 waiting')).toBeTruthy();
    });
    expect(() => getByRole('button', { name: /^Accept$/ })).toThrow();
  });

  it('restores optimistic hidden rows when refreshed suggestion item data changes', async () => {
    const user = userEvent.setup();
    const suggestion = {
      id: 'bundle-1',
      source: 'background',
      status: 'pending',
      title: 'Schedule follow-up',
      summary: null,
      reason: null,
      confidence: 'high',
      createdAt: '2026-06-01T10:00:00.000Z',
      evidence: [],
      items: [
        {
          id: 'item-1',
          status: 'pending',
          operation: 'create',
          targetKind: 'calendar_event',
          targetId: null,
          title: 'Customer follow-up',
          description: null,
          proposedPayload: { title: 'Customer follow-up' },
          failureReason: null,
        },
      ],
    };

    const folded = {
      title: 'Calendar approvals',
      summary: {
        singular: 'waiting',
        plural: 'waiting',
      },
      className: 'border-y border-border py-4',
    };

    const { getByRole, getByText, rerender } = render(
      createElement(ApprovalsClient, {
        folded,
        suggestions: [suggestion],
      }),
    );

    await user.click(getByRole('button', { name: /^Accept$/ }));
    await waitFor(() => {
      expect(getByText('0 waiting')).toBeTruthy();
    });

    const originalItem = suggestion.items[0];
    if (!originalItem) throw new Error('Missing test suggestion item');

    rerender(
      createElement(ApprovalsClient, {
        folded,
        suggestions: [
          {
            ...suggestion,
            items: [{ ...originalItem, title: 'Updated customer follow-up' }],
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(getByText('1 waiting')).toBeTruthy();
    });
    expect(getByRole('button', { name: /^Accept$/ })).toBeTruthy();
  });

  it('guards per-item actions against same-tick duplicate clicks', () => {
    fakes.acceptSuggestionItemAction.mockReturnValue(new Promise(() => undefined));

    const { getByRole } = render(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Schedule follow-up',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-1',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Customer follow-up',
                description: null,
                proposedPayload: { title: 'Customer follow-up' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    const accept = getByRole('button', { name: /^Accept$/ });
    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(fakes.acceptSuggestionItemAction).toHaveBeenCalledTimes(1);
  });
});
