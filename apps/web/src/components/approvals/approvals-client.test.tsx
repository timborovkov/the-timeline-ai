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
  rejectVisibleSuggestionsAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@/app/actions/suggestions', () => ({
  acceptAllSuggestionAction: fakes.acceptAllSuggestionAction,
  acceptSuggestionItemAction: fakes.acceptSuggestionItemAction,
  acceptVisibleSuggestionsAction: fakes.acceptVisibleSuggestionsAction,
  rejectSuggestionItemAction: fakes.rejectSuggestionItemAction,
  rejectVisibleSuggestionsAction: fakes.rejectVisibleSuggestionsAction,
}));

const { ApprovalsClient } = await import('./approvals-client.js');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.acceptAllSuggestionAction.mockResolvedValue({ ok: true });
  fakes.acceptSuggestionItemAction.mockResolvedValue({ ok: true });
  fakes.acceptVisibleSuggestionsAction.mockResolvedValue({ ok: true });
  fakes.rejectSuggestionItemAction.mockResolvedValue({ ok: true });
  fakes.rejectVisibleSuggestionsAction.mockResolvedValue({ ok: true });
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
        timezone: 'America/Los_Angeles',
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Follow up with Acme',
            summary: 'A commitment was found.',
            reason: 'Timeline source evidence',
            confidence: 'high',
            metadata: {
              reconciliation_output_ids: ['99999999-9999-4999-8999-999999999999'],
              reconciliation_cluster_ids: ['22222222-2222-4222-8222-222222222222'],
            },
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
                proposedPayload: {
                  canonicalName: 'Send proposal',
                  dueAt: '2026-07-19T00:00:00.000Z',
                  status: 'todo',
                },
                metadata: {
                  reconciliation_output_id: '99999999-9999-4999-8999-999999999999',
                  reconciliation_cluster_id: '22222222-2222-4222-8222-222222222222',
                },
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
                metadata: {},
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
    expect(html).toContain('Evidence from Slack');
    expect(html).toContain('create task');
    expect(html).toContain('Due Jul 19, 2026 · Status To do');
    expect(html).not.toContain('Due Jul 18, 2026');
    expect(html).toContain('Why this was suggested · 1 source');
    expect(html).toContain('Technical details');
    expect(html).toContain('Open processing record');
    expect(html).not.toContain('Reconciliation output');
    expect(html).not.toContain('outputs 99999999');
    expect(html).not.toContain('Cluster 22222222');
    expect(html).not.toContain('Proposal · pending');
    expect(html).toContain(
      'href="/app/team/reconciliation/clusters/22222222-2222-4222-8222-222222222222"',
    );
  });

  it('keeps every processing record reachable for multi-cluster bundles', () => {
    const firstClusterId = '22222222-2222-4222-8222-222222222222';
    const secondClusterId = '33333333-3333-4333-8333-333333333333';
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-multi-cluster',
            source: 'background',
            status: 'pending',
            title: 'Update two customer records',
            summary: null,
            reason: null,
            confidence: 'medium',
            metadata: { reconciliation_cluster_ids: [firstClusterId, secondClusterId] },
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-first-cluster',
                status: 'pending',
                operation: 'update',
                targetKind: 'object',
                targetId: '44444444-4444-4444-8444-444444444444',
                title: 'Update Acme',
                description: null,
                proposedPayload: { stage: 'contract_review' },
                metadata: { reconciliation_cluster_id: firstClusterId },
                failureReason: null,
              },
              {
                id: 'item-second-cluster',
                status: 'pending',
                operation: 'update',
                targetKind: 'object',
                targetId: '55555555-5555-4555-8555-555555555555',
                title: 'Update Beta',
                description: null,
                proposedPayload: { stage: 'discovery' },
                metadata: { reconciliation_cluster_id: secondClusterId },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Open processing record 1 of 2');
    expect(html).toContain('Open processing record 2 of 2');
    expect(html).toContain(`/app/team/reconciliation/clusters/${firstClusterId}`);
    expect(html).toContain(`/app/team/reconciliation/clusters/${secondClusterId}`);
  });

  it('preserves literal payload values and exposes every meaningful proposed change', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        timezone: 'America/Los_Angeles',
        suggestions: [
          {
            id: 'bundle-literal-values',
            source: 'chat',
            status: 'pending',
            title: 'Remember customer details',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-identity',
                status: 'pending',
                operation: 'create',
                targetKind: 'identity_facet',
                targetId: null,
                title: 'Add GitHub identity',
                description: null,
                proposedPayload: {
                  entityId: '33333333-3333-4333-8333-333333333333',
                  kind: 'github',
                  value: 'john-doe_work@example.com',
                },
                failureReason: null,
              },
              {
                id: 'item-object',
                status: 'pending',
                operation: 'create',
                targetKind: 'object',
                targetId: null,
                title: 'Acme renewal',
                description: null,
                proposedPayload: {
                  type: 'project',
                  canonicalName: 'Acme renewal',
                  aliases: ['ACME-v2'],
                  status: 'active',
                  stage: 'contract_review',
                  priority: 1,
                  ownerName: 'Jane-Doe',
                  assigneeName: 'Sam_Taylor',
                  dueAt: '2026-07-19T00:00:00.000Z',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('john-doe_work@example.com');
    expect(html).not.toContain('John doe work@example.com');
    expect(html).toContain('Also known as ACME-v2');
    expect(html).not.toContain('Name Acme renewal');
    expect(html).toContain('Show all 8 changes');
    expect(html).toContain('>Priority</dt>');
    expect(html).toContain('>Jane-Doe</dd>');
    expect(html).toContain('>Sam_Taylor</dd>');
    expect(html).toContain('>Jul 19, 2026</dd>');
  });

  it('shows the named audience for specific-user visibility changes', () => {
    const firstUserId = '33333333-3333-4333-8333-333333333333';
    const secondUserId = '44444444-4444-4444-8444-444444444444';
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        timezone: 'UTC',
        suggestions: [
          {
            id: 'bundle-specific-audience',
            source: 'background',
            status: 'pending',
            title: 'Share the calendar review',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-specific-audience',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Private review',
                description: null,
                proposedPayload: {
                  title: 'Private review',
                  startAt: '2026-06-17T11:00:00.000Z',
                  endAt: '2026-06-17T12:00:00.000Z',
                  timezone: 'UTC',
                  visibility: 'specific_users',
                  visibilityUserIds: [firstUserId, secondUserId],
                  visibilityUserNames: ['Owner', 'Reviewer'],
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('People with access Owner, Reviewer');
    expect(html).not.toContain(firstUserId);
    expect(html).not.toContain(secondUserId);
  });

  it('does not clamp short fields when there is no disclosure', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-medium-fields',
            source: 'chat',
            status: 'pending',
            title: 'Update customer details',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-medium-fields',
                status: 'pending',
                operation: 'update',
                targetKind: 'object',
                targetId: '55555555-5555-4555-8555-555555555555',
                title: 'Update customer details',
                description: null,
                proposedPayload: {
                  description:
                    'A concise account summary that still needs more than one visual line.',
                  notes: 'Keep the procurement owner informed before changing the delivery plan.',
                  nextStep:
                    'Schedule a review with finance and confirm the revised commercial terms.',
                  stage: 'contract_review',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).not.toContain('line-clamp-2');
    expect(html).not.toContain('Show full change');
    expect(html).toContain('confirm the revised commercial terms');
  });

  it('shows a proposed object rename when the item title is generic', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-rename',
            source: 'chat',
            status: 'pending',
            title: 'Update customer memory',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-rename',
                status: 'pending',
                operation: 'update',
                targetKind: 'object',
                targetId: '44444444-4444-4444-8444-444444444444',
                title: 'Update object memory',
                description: null,
                proposedPayload: { canonicalName: 'Acme Renewal 2027' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Name Acme Renewal 2027');
  });

  it('formats board item updates using the field being changed', () => {
    const responsibleUserId = '55555555-5555-4555-8555-555555555555';
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        timezone: 'America/Los_Angeles',
        suggestions: [
          {
            id: 'bundle-board-updates',
            source: 'chat',
            status: 'pending',
            title: 'Update the launch board',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-board-due-date',
                status: 'pending',
                operation: 'update',
                targetKind: 'board_item_update',
                targetId: '66666666-6666-4666-8666-666666666666',
                title: 'Set launch review due date',
                description: null,
                proposedPayload: {
                  boardItemId: '66666666-6666-4666-8666-666666666666',
                  field: 'dueAt',
                  newValue: '2026-07-19T00:00:00.000Z',
                },
                failureReason: null,
              },
              {
                id: 'item-board-responsible',
                status: 'pending',
                operation: 'update',
                targetKind: 'board_item_update',
                targetId: '77777777-7777-4777-8777-777777777777',
                title: 'Assign launch review',
                description: null,
                proposedPayload: {
                  boardItemId: '77777777-7777-4777-8777-777777777777',
                  field: 'responsibleUserId',
                  newValue: responsibleUserId,
                  responsibleName: 'Reviewer',
                },
                failureReason: null,
              },
              {
                id: 'item-board-lane',
                status: 'pending',
                operation: 'update',
                targetKind: 'board_item_update',
                targetId: '88888888-8888-4888-8888-888888888888',
                title: 'Move launch review',
                description: null,
                proposedPayload: {
                  boardItemId: '88888888-8888-4888-8888-888888888888',
                  field: 'laneId',
                  newValue: '99999999-9999-4999-8999-999999999999',
                  laneName: 'Blocked',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Due Jul 19, 2026');
    expect(html).not.toContain('2026-07-19T00:00:00.000Z');
    expect(html).toContain('Responsible Reviewer');
    expect(html).not.toContain(responsibleUserId);
    expect(html).toContain('Lane Blocked');
    expect(html).not.toContain('Selected lane');
    expect(html).not.toContain('Field Due at');
  });

  it('shows board membership destinations without exposing their ids', () => {
    const boardId = '66666666-6666-4666-8666-666666666666';
    const entityId = '77777777-7777-4777-8777-777777777777';
    const laneId = '88888888-8888-4888-8888-888888888888';
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-board-membership',
            source: 'background',
            status: 'pending',
            title: 'Update the pilot board',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-board-membership',
                status: 'pending',
                operation: 'create',
                targetKind: 'board_membership',
                targetId: null,
                title: 'Add customer to board',
                description: null,
                proposedPayload: {
                  boardId,
                  boardName: 'Pilot pipeline',
                  entityId,
                  entityName: 'Digital Audit Company',
                  laneId,
                  laneName: 'Discovery',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Board Pilot pipeline');
    expect(html).toContain('Item Digital Audit Company');
    expect(html).toContain('Lane Discovery');
    expect(html).not.toContain(boardId);
    expect(html).not.toContain(entityId);
    expect(html).not.toContain(laneId);
  });

  it('does not roll an invalid task date into a different calendar date', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-invalid-date',
            source: 'chat',
            status: 'pending',
            title: 'Create task with invalid date',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-invalid-date',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Invalid date task',
                description: null,
                proposedPayload: {
                  canonicalName: 'Invalid date task',
                  dueAt: '2026-02-30',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Due 2026-02-30');
    expect(html).not.toContain('Mar 2, 2026');
  });

  it('shows values that an update will clear', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-clear-values',
            source: 'chat',
            status: 'pending',
            title: 'Clear stale task details',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-clear-values',
                status: 'pending',
                operation: 'update',
                targetKind: 'task',
                targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                title: 'Clear stale task details',
                description: null,
                proposedPayload: {
                  dueAt: null,
                  stage: null,
                  ownerUserId: null,
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Due None · Stage None · Owner Unassigned');
  });

  it('keeps the rationale available when a bundle has no evidence rows', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-reason-only',
            source: 'chat',
            status: 'pending',
            title: 'Update customer memory',
            summary: null,
            reason: 'The customer explicitly confirmed the renewal stage.',
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-reason-only',
                status: 'pending',
                operation: 'update',
                targetKind: 'object',
                targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                title: 'Update renewal stage',
                description: null,
                proposedPayload: { stage: 'contract_review' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Why this was suggested');
    expect(html).toContain('The customer explicitly confirmed the renewal stage.');
  });

  it('renders missing-person relationship bundles with readable endpoints', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Remember Jonne Granqvist and DFK',
            summary: 'This person appears connected to the object in source-backed evidence.',
            reason: 'An extracted fact connects this person to the object.',
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [
              {
                rawEventId: EVENT_ID,
                quote: 'Jonne Granqvist from DFK discussed the pilot scope.',
                occurredAt: '2026-06-01T10:00:00.000Z',
                source: 'web',
              },
            ],
            items: [
              {
                id: 'item-person',
                status: 'pending',
                operation: 'create',
                targetKind: 'object',
                targetId: null,
                title: 'Jonne Granqvist',
                description: 'An extracted fact connects this person to the object.',
                proposedPayload: {
                  type: 'person',
                  canonicalName: 'Jonne Granqvist',
                  localRef: 'jonne-granqvist',
                },
                failureReason: null,
              },
              {
                id: 'item-relationship',
                status: 'pending',
                operation: 'create',
                targetKind: 'object_relationship',
                targetId: null,
                title: 'Relate Jonne Granqvist and DFK',
                description: 'An extracted fact connects this person to the object.',
                proposedPayload: {
                  fromRef: 'jonne-granqvist',
                  toEntityId: '44444444-4444-4444-8444-444444444444',
                  fromName: 'Jonne Granqvist',
                  toName: 'DFK',
                  kind: 'related',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('create person');
    expect(html).toContain('Jonne Granqvist ↔ DFK · related');
    expect(html).toContain('Depends on Jonne Granqvist in this bundle.');
    expect(html).toContain('Jonne Granqvist from DFK discussed the pilot scope.');
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

    await userEvent.click(screen.getByText('Why this was suggested · 1 source'));
    await userEvent.click(screen.getByRole('button', { name: /Evidence from Slack/ }));

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

  it('can hide bulk accept while keeping bulk reject for filtered approval surfaces', () => {
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
    expect(html).toContain('Reject all visible');
    expect(html).toContain('Send proposal');
    expect(html).toContain('Book review');
  });

  it('can hide page-level reject all when bulk reject is disabled', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        allowBulkReject: false,
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

    expect(html).not.toContain('Reject all visible');
    expect(html).toContain('Accept all');
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

  it('shows the proposed schedule for calendar match warnings', () => {
    const matchingEvent = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Acme planning',
      description: null,
      startAt: '2026-06-17T11:00:00.000Z',
      endAt: '2026-06-17T12:00:00.000Z',
      timezone: 'UTC',
      allDay: false,
      location: null,
      showAs: 'busy',
      visibility: 'team',
      rrule: null,
    };
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        timezone: 'UTC',
        suggestions: [
          {
            id: 'bundle-calendar-warnings',
            source: 'background',
            status: 'pending',
            title: 'Calendar warnings',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-semantic-warning',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Acme planning',
                description: null,
                proposedPayload: {
                  title: 'Acme planning',
                  startAt: '2026-06-20T11:00:00.000Z',
                  endAt: '2026-06-20T12:00:00.000Z',
                  timezone: 'UTC',
                  allDay: false,
                },
                calendarResolutionHint: {
                  kind: 'semantic_update_candidate',
                  event: matchingEvent,
                },
                failureReason: null,
              },
              {
                id: 'item-ambiguous-warning',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Acme review',
                description: null,
                proposedPayload: {
                  title: 'Acme review',
                  startAt: '2026-06-21T13:00:00.000Z',
                  endAt: '2026-06-21T14:00:00.000Z',
                  timezone: 'UTC',
                  allDay: false,
                },
                calendarResolutionHint: {
                  kind: 'ambiguous_match',
                  events: [
                    matchingEvent,
                    { ...matchingEvent, id: '22222222-2222-4222-8222-222222222222' },
                  ],
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html.match(/Proposed:/g)).toHaveLength(2);
    expect(html).toContain('Jun 20, 2026, 11:00 AM');
    expect(html).toContain('Jun 21, 2026, 1:00 PM');
    expect(html).not.toContain('2026-06-20T11:00:00.000Z');
  });

  it('does not repeat raw date fields for all-day calendar proposals', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        timezone: 'UTC',
        suggestions: [
          {
            id: 'bundle-all-day',
            source: 'background',
            status: 'pending',
            title: 'All-day calendar proposal',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-all-day',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'All-day review',
                description: null,
                proposedPayload: {
                  title: 'All-day review',
                  startAt: '2026-06-21T00:00:00.000Z',
                  endAt: '2026-06-22T00:00:00.000Z',
                  startDate: '2026-06-21',
                  endDate: '2026-06-22',
                  timezone: 'UTC',
                  allDay: true,
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Scheduled for Jun 21, 2026');
    expect(html).not.toContain('Start date');
    expect(html).not.toContain('End date');
    expect(html).not.toContain('2026-06-21T00:00:00.000Z');
  });

  it('renders all-day calendar proposal ranges as date-only labels in the event timezone', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        timezone: 'America/New_York',
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
                id: 'item-all-day',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Nexia offsite',
                description: null,
                proposedPayload: {
                  title: 'Nexia offsite',
                  startAt: '2026-06-16T21:00:00.000Z',
                  endAt: '2026-06-17T21:00:00.000Z',
                  timezone: 'Europe/Helsinki',
                  allDay: true,
                },
                calendarResolutionHint: { kind: 'new_event' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Scheduled for Jun 17, 2026.');
    expect(html).not.toContain('5:00 PM');
    expect(html).not.toContain('12:00 AM');
  });

  it('shows calendar field changes in addition to the proposed range', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        timezone: 'Europe/Helsinki',
        suggestions: [
          {
            id: 'bundle-calendar-update',
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
                id: 'item-calendar-update',
                status: 'pending',
                operation: 'update',
                targetKind: 'calendar_event',
                targetId: '33333333-3333-4333-8333-333333333333',
                title: 'Move Acme planning',
                description: null,
                proposedPayload: {
                  startAt: '2026-06-18T11:00:00.000Z',
                  endAt: '2026-06-18T12:00:00.000Z',
                  allDay: false,
                  description: null,
                  location: null,
                  reminderMinutes: null,
                  showAs: 'free',
                },
                calendarResolutionHint: { kind: 'new_event' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Scheduled for');
    expect(html).toContain('Details None');
    expect(html).toContain('Location None');
    expect(html).toContain('Reminder None');
    expect(html).toContain('Availability: free');
    expect(html).not.toContain('Start at');
    expect(html).not.toContain('End at');
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

  it('labels mixed bulk accept as a partial visible action when merge rows need review', async () => {
    const user = userEvent.setup();

    render(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-actions',
            source: 'background',
            status: 'pending',
            title: 'Customer actions',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-task',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send renewal packet',
                description: null,
                proposedPayload: { canonicalName: 'Send renewal packet' },
                failureReason: null,
              },
              {
                id: 'item-calendar',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Book renewal call',
                description: null,
                proposedPayload: { title: 'Book renewal call' },
                failureReason: null,
              },
            ],
          },
          {
            id: 'bundle-merge',
            source: 'background',
            status: 'pending',
            title: 'Merge duplicate Acme objects',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:05:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-merge',
                status: 'pending',
                operation: 'merge',
                targetKind: 'object_merge',
                targetId: null,
                title: 'Merge Acme duplicates',
                description: null,
                proposedPayload: {
                  objectIds: [
                    '33333333-3333-4333-8333-333333333333',
                    '44444444-4444-4444-8444-444444444444',
                  ],
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(screen.queryByRole('button', { name: 'Accept all visible' })).toBeNull();
    expect(screen.getByText('1 merge proposal needs review')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Accept 2 visible' }));

    expect(fakes.acceptVisibleSuggestionsAction).toHaveBeenCalledTimes(1);
    expect(fakes.acceptVisibleSuggestionsAction).toHaveBeenCalledWith({
      suggestions: [
        {
          suggestionId: 'bundle-actions',
          itemIds: ['item-task', 'item-calendar'],
        },
      ],
    });
  });

  it('restores only failed rows after a partial visible bulk accept failure', async () => {
    const user = userEvent.setup();
    fakes.acceptVisibleSuggestionsAction.mockResolvedValue({
      error: '1 item(s) failed to apply',
      failedItemIds: ['item-calendar'],
    });

    render(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-actions',
            source: 'background',
            status: 'pending',
            title: 'Customer actions',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-task',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send renewal packet',
                description: null,
                proposedPayload: { canonicalName: 'Send renewal packet' },
                failureReason: null,
              },
              {
                id: 'item-calendar',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Book renewal call',
                description: null,
                proposedPayload: { title: 'Book renewal call' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Accept all visible' }));

    await waitFor(() => {
      expect(screen.queryByText('Send renewal packet')).toBeNull();
      expect(screen.getByText('Book renewal call')).toBeTruthy();
      expect(screen.getByText('1 item(s) failed to apply')).toBeTruthy();
      expect(screen.getByText(/Calendar proposal is missing a start or end time/)).toBeTruthy();
      expect(
        screen.getByText(
          'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
        ),
      ).toBeTruthy();
    });
    expect(fakes.refresh).not.toHaveBeenCalled();
  });

  it('restores only failed rows after a stale bundle-level accept-all failure', async () => {
    const user = userEvent.setup();
    fakes.acceptAllSuggestionAction.mockResolvedValue({
      error: '1 item(s) failed to apply',
      failedItemIds: ['item-calendar'],
    });

    render(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-actions',
            source: 'background',
            status: 'pending',
            title: 'Customer actions',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-task',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send renewal packet',
                description: null,
                proposedPayload: { canonicalName: 'Send renewal packet' },
                failureReason: null,
              },
              {
                id: 'item-calendar',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Book renewal call',
                description: null,
                proposedPayload: { title: 'Book renewal call' },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Accept all' }));

    await waitFor(() => {
      expect(fakes.acceptAllSuggestionAction).toHaveBeenCalledWith({
        suggestionId: 'bundle-actions',
        itemIds: ['item-task', 'item-calendar'],
      });
      expect(screen.queryByText('Send renewal packet')).toBeNull();
      expect(screen.getByText('Book renewal call')).toBeTruthy();
      expect(screen.getByText('1 item(s) failed to apply')).toBeTruthy();
      expect(screen.getByText(/Calendar proposal is missing a start or end time/)).toBeTruthy();
    });
    expect(fakes.refresh).not.toHaveBeenCalled();
  });

  it('labels mixed bundle accept as partial when a merge row must be reviewed separately', () => {
    render(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Resolve Acme records',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: 'item-task',
                status: 'pending',
                operation: 'create',
                targetKind: 'task',
                targetId: null,
                title: 'Send renewal packet',
                description: null,
                proposedPayload: { canonicalName: 'Send renewal packet' },
                failureReason: null,
              },
              {
                id: 'item-calendar',
                status: 'pending',
                operation: 'create',
                targetKind: 'calendar_event',
                targetId: null,
                title: 'Book renewal call',
                description: null,
                proposedPayload: { title: 'Book renewal call' },
                failureReason: null,
              },
              {
                id: 'item-merge',
                status: 'pending',
                operation: 'merge',
                targetKind: 'object_merge',
                targetId: null,
                title: 'Merge Acme duplicates',
                description: null,
                proposedPayload: {
                  objectIds: [
                    '33333333-3333-4333-8333-333333333333',
                    '44444444-4444-4444-8444-444444444444',
                  ],
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByRole('button', { name: 'Accept 2' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Review merge/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept all' })).toBeNull();
  });

  it('renders page-level reject all for merge-only visible bundles', async () => {
    const user = userEvent.setup();

    render(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-1',
            source: 'background',
            status: 'pending',
            title: 'Merge duplicate Acme objects',
            summary: null,
            reason: null,
            confidence: 'high',
            createdAt: '2026-06-01T10:00:00.000Z',
            evidence: [],
            items: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                status: 'pending',
                operation: 'merge',
                targetKind: 'object_merge',
                targetId: null,
                title: 'Merge Acme duplicates',
                description: null,
                proposedPayload: {
                  objectIds: [
                    '33333333-3333-4333-8333-333333333333',
                    '44444444-4444-4444-8444-444444444444',
                  ],
                },
                failureReason: null,
              },
            ],
          },
          {
            id: 'bundle-2',
            source: 'background',
            status: 'pending',
            title: 'Merge duplicate Globex objects',
            summary: null,
            reason: null,
            confidence: 'medium',
            createdAt: '2026-06-01T10:05:00.000Z',
            evidence: [],
            items: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                status: 'failed',
                operation: 'merge',
                targetKind: 'object_merge',
                targetId: null,
                title: 'Merge Globex duplicates',
                description: null,
                proposedPayload: {
                  objectIds: [
                    '55555555-5555-4555-8555-555555555555',
                    '66666666-6666-4666-8666-666666666666',
                  ],
                },
                failureReason: 'Merge preview failed',
              },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: /Reject all visible/ }));

    expect(fakes.rejectVisibleSuggestionsAction).toHaveBeenCalledWith({
      suggestions: [
        {
          suggestionId: 'bundle-1',
          itemIds: ['11111111-1111-4111-8111-111111111111'],
        },
        {
          suggestionId: 'bundle-2',
          itemIds: ['22222222-2222-4222-8222-222222222222'],
        },
      ],
    });
    expect(fakes.acceptVisibleSuggestionsAction).not.toHaveBeenCalled();
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

  it('uses payload endpoint names for existing-object relationship summaries', () => {
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
                title: 'Relate Research and Development and Sales and Ops',
                description: null,
                proposedPayload: {
                  fromEntityId: '11111111-1111-4111-8111-111111111111',
                  toEntityId: '22222222-2222-4222-8222-222222222222',
                  fromName: 'Research and Development',
                  toName: 'Sales and Ops',
                  kind: 'related',
                },
                failureReason: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Research and Development ↔ Sales and Ops · related');
    expect(html).not.toContain('existing object ↔ existing object');
  });

  it('does not split unlabeled existing-object relationship summaries on title text', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsClient, {
        suggestions: [
          {
            id: 'bundle-existing-relationship',
            source: 'background',
            status: 'pending',
            title: 'Remember Research and Development and Sales and Ops',
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
                title: 'Relate Research and Development and Sales and Ops',
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

    expect(html).toContain('Relate Research and Development and Sales and Ops · related');
    expect(html).not.toContain('Research ↔ Development and Sales and Ops');
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

  it('shows an updating state when optimistic approval removes the last visible row', async () => {
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

    fireEvent.click(getByRole('button', { name: /^Accept$/ }));

    await waitFor(() => {
      expect(getByRole('status').textContent).toContain('Updating approvals');
    });
    expect(fakes.acceptSuggestionItemAction).toHaveBeenCalledWith({ itemId: 'item-1' });
  });

  it('restores failed optimistic actions with row-level retry feedback', async () => {
    const user = userEvent.setup();
    fakes.acceptSuggestionItemAction.mockResolvedValue({ error: 'Calendar write failed' });

    const { getByRole, getByText } = render(
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

    await user.click(getByRole('button', { name: /^Accept$/ }));

    await waitFor(() => {
      expect(getByText('Customer follow-up')).toBeTruthy();
      expect(getByText('Calendar write failed')).toBeTruthy();
      expect(getByText(/Calendar proposal is missing a start or end time/)).toBeTruthy();
    });
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
