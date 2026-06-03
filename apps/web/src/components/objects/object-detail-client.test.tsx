import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@/app/actions/objects', () => ({
  acceptObjectChangeAction: vi.fn(),
  addRelationshipAction: vi.fn(),
  archiveObjectAction: vi.fn(),
  createNoteAction: vi.fn(),
  deleteNoteAction: vi.fn(),
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
  dueAt: '2026-06-05T12:00:00.000Z',
  sourceEventId: null,
  agentSuggested: false,
  archivedAt: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  notes: [],
  relationships: [],
  relatedObjects: [],
  openTasks: [],
  recentChanges: [],
  facts: [],
  timelineEvents: [],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ObjectDetailClient', () => {
  it('renders object detail sections and archive control', () => {
    const html = renderToStaticMarkup(
      createElement(ObjectDetailClient, { detail, userId: 'user-1', suggestions: [] }),
    );

    expect(html).toContain('Send proposal');
    expect(html).toContain('Notes');
    expect(html).toContain('Open tasks');
    expect(html).toContain('Related');
    expect(html).toContain('Recent changes');
    expect(html).toContain('Archive object');
  });

  it('renders pending approvals on the object detail surface', () => {
    const html = renderToStaticMarkup(
      createElement(ObjectDetailClient, {
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
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Pending approvals');
    expect(html).toContain('Update proposal stage');
    expect(html).toContain('Move to proposal');
  });
});
