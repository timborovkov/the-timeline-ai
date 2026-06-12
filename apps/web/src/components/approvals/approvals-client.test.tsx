import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@/app/actions/suggestions', () => ({
  acceptAllSuggestionAction: vi.fn(),
  acceptSuggestionItemAction: vi.fn(),
  rejectSuggestionItemAction: vi.fn(),
}));

const { ApprovalsClient } = await import('./approvals-client.js');

beforeEach(() => {
  vi.clearAllMocks();
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
});
