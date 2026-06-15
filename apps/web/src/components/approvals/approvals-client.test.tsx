// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  vi.clearAllMocks();
  fakes.acceptAllSuggestionAction.mockResolvedValue({ ok: true });
  fakes.acceptSuggestionItemAction.mockResolvedValue({ ok: true });
  fakes.acceptVisibleSuggestionsAction.mockResolvedValue({ ok: true });
  fakes.rejectSuggestionItemAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
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
                rawEventId: '11111111-1111-4111-8111-111111111111',
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
    expect(html).toContain(
      '/app/timeline?event=11111111-1111-4111-8111-111111111111#ev-11111111-1111-4111-8111-111111111111',
    );
    expect(html).toContain('create task');
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
