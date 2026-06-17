import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';

const fakes = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => fakes }));
vi.mock('@/app/actions/objects', () => ({
  findObjectCleanupSuggestionsAction: vi.fn(),
  mergeObjectsAction: vi.fn(),
}));
vi.mock('@/app/actions/suggestions', () => ({
  acceptSuggestionItemAction: vi.fn(),
  rejectSuggestionItemAction: vi.fn(),
}));

const { ObjectCleanupSuggestions } = await import('./object-cleanup-suggestions.js');

const baseObject = {
  type: 'topic',
  aliases: [],
  metadata: {},
  status: 'open',
  stage: null,
  priority: null,
  ownerUserId: null,
  assigneeUserId: null,
  dueAt: null,
  agentSuggested: false,
  archivedAt: null,
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
} satisfies Omit<objects.ObjectRow, 'id' | 'canonicalName'>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ObjectCleanupSuggestions', () => {
  it('opens merge review from the cleanup list instead of linking to the merge page', () => {
    const itemId = 'item-1';
    const survivorId = 'object-a';
    const duplicateId = 'object-b';
    const html = renderToStaticMarkup(
      createElement(ObjectCleanupSuggestions, {
        suggestions: [
          {
            id: 'bundle-1',
            title: 'Object cleanup',
            summary: null,
            confidence: 'medium',
            items: [
              {
                id: itemId,
                status: 'pending',
                operation: 'merge',
                targetKind: 'object_merge',
                targetId: survivorId,
                title: 'Review merge for Trade register extract',
                description: 'Names are similar enough to review as a possible duplicate.',
                proposedPayload: { objectIds: [survivorId, duplicateId], survivorId },
              },
            ],
          },
        ],
        mergePreviewsByItemId: {
          [itemId]: {
            objects: [
              { ...baseObject, id: survivorId, canonicalName: 'Trade register extract' },
              { ...baseObject, id: duplicateId, canonicalName: 'trade register extracts' },
            ],
            survivorId,
            aliasesToAdd: ['trade register extracts'],
            counts: { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
            countsBySurvivorId: {
              [survivorId]: { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
              [duplicateId]: { facts: 2, notes: 0, relationships: 0, openTasks: 0 },
            },
            factSamplesByObjectId: {
              [survivorId]: [
                {
                  id: 'fact-a',
                  statement: 'Trade register extract belongs to AuditAI.',
                  confidence: 0.9,
                  rawEventId: 'event-a',
                  extractedAt: new Date('2026-06-01T10:00:00.000Z'),
                },
              ],
              [duplicateId]: [
                {
                  id: 'fact-b',
                  statement: 'trade register extracts are pending import.',
                  confidence: 0.8,
                  rawEventId: 'event-b',
                  extractedAt: new Date('2026-06-01T10:00:00.000Z'),
                },
              ],
            },
          },
        },
      }),
    );

    expect(html).toContain('Review merge for Trade register extract');
    expect(html).toContain('Review');
    expect(html).not.toContain('/app/objects/merge');
  });

  it('keeps merge suggestions reviewable when the modal preview was not preloaded', () => {
    const itemId = 'item-1';
    const survivorId = 'object-a';
    const duplicateId = 'object-b';
    const html = renderToStaticMarkup(
      createElement(ObjectCleanupSuggestions, {
        suggestions: [
          {
            id: 'bundle-1',
            title: 'Object cleanup',
            summary: null,
            confidence: 'medium',
            items: [
              {
                id: itemId,
                status: 'pending',
                operation: 'merge',
                targetKind: 'object_merge',
                targetId: survivorId,
                title: 'Review merge for Trade register extract',
                description: 'Names are similar enough to review as a possible duplicate.',
                proposedPayload: { objectIds: [survivorId, duplicateId], survivorId },
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('/app/objects/merge?');
    expect(html).toContain(`suggestionItemId=${itemId}`);
    expect(html).not.toContain('disabled=""');
  });

  it('renders paged cleanup suggestions when more than one page is pending', () => {
    const suggestions = Array.from({ length: 12 }, (_, index) => ({
      id: `bundle-${index}`,
      title: 'Object cleanup',
      summary: null,
      confidence: 'medium',
      items: [
        {
          id: `item-${index}`,
          status: 'pending',
          operation: 'archive_or_cancel',
          targetKind: 'object',
          targetId: `object-${index}`,
          title: `Archive object ${index + 1}`,
          description: 'Archive this low-signal object.',
          proposedPayload: {},
        },
      ],
    }));

    const html = renderToStaticMarkup(createElement(ObjectCleanupSuggestions, { suggestions }));

    expect(html).toContain('1-10 of 12');
    expect(html).toContain('Page 1 / 2');
    expect(html).toContain('Archive object 10');
    expect(html).not.toContain('Archive object 11');
  });
});
