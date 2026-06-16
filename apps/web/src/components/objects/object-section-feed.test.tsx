// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ObjectSectionQueryData {
  pages: { items: Record<string, unknown>[] }[];
}

const fakes = vi.hoisted(() => {
  const data: ObjectSectionQueryData = {
    pages: [
      {
        items: [
          {
            id: 'fact-1',
            statement: 'Atlas rollout depends on Northwind approval.',
            confidence: 0.91,
            sharedObjects: [
              {
                id: 'object-2',
                canonicalName: 'Northwind',
                type: 'company',
                role: 'object',
              },
              {
                id: 'object-3',
                canonicalName: 'Mia Chen',
                type: 'person',
                role: 'topic',
              },
            ],
          },
        ],
      },
    ],
  };
  return {
    query: {
      data,
      isPending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    },
  };
});

function factData(): ObjectSectionQueryData {
  return {
    pages: [
      {
        items: [
          {
            id: 'fact-1',
            statement: 'Atlas rollout depends on Northwind approval.',
            confidence: 0.91,
            sharedObjects: [
              {
                id: 'object-2',
                canonicalName: 'Northwind',
                type: 'company',
                role: 'object',
              },
              {
                id: 'object-3',
                canonicalName: 'Mia Chen',
                type: 'person',
                role: 'topic',
              },
            ],
          },
        ],
      },
    ],
  };
}

function emptyEventData(): ObjectSectionQueryData {
  return {
    pages: [
      {
        items: [
          {
            id: 'event-1',
            contentText: null,
            occurredAt: '2026-06-14T12:00:00.000Z',
            source: 'telegram',
          },
        ],
      },
    ],
  };
}

function changeData(): ObjectSectionQueryData {
  return {
    pages: [
      {
        items: [
          {
            id: 'change-1',
            field: '__merge__',
            previousValue: null,
            newValue: {
              aliases: ['ProCounter'],
              survivor_id: 'object-1',
              merged_entity_ids: ['object-2'],
            },
            actorKind: 'user',
            status: 'applied',
          },
        ],
      },
    ],
  };
}

function emptyEventResponse() {
  return new Response(
    JSON.stringify({
      items: [
        {
          id: 'event-1',
          source: 'telegram',
          contentText: null,
          contentAudioUrl: null,
          occurredAt: '2026-06-14T12:00:00.000Z',
        },
      ],
      audioUrls: {},
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

vi.mock('@/lib/use-paginated-queries', () => ({
  useObjectSectionQuery: () => fakes.query,
}));

const { ObjectSectionFeed } = await import('./object-section-feed.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.query.data = factData();
  fakes.query.hasNextPage = false;
  fakes.query.isFetchingNextPage = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectSectionFeed', () => {
  it('renders navigable shared-object links on fact rows', () => {
    const html = renderToStaticMarkup(
      createElement(ObjectSectionFeed, {
        objectId: 'object-1',
        section: 'facts',
        title: 'Facts',
      }),
    );

    expect(html).toContain('Atlas rollout depends on Northwind approval.');
    expect(html).toContain('Fact (2)');
    expect(html).toContain('Objects sharing this fact');
    expect(html).toContain('/app/objects/object-2');
    expect(html).toContain('Northwind');
    expect(html).toContain('/app/objects/object-3');
    expect(html).toContain('Mia Chen');
  });

  it('does not render a fake end control when a section has no next page', () => {
    render(
      createElement(ObjectSectionFeed, {
        objectId: 'object-1',
        section: 'facts',
        title: 'Facts',
      }),
    );

    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('renders object changes as readable summaries instead of raw JSON', () => {
    fakes.query.data = changeData();

    const html = renderToStaticMarkup(
      createElement(ObjectSectionFeed, {
        objectId: 'object-1',
        section: 'changes',
        title: 'Changes',
      }),
    );

    expect(html).toContain('Merge');
    expect(html).toContain('empty');
    expect(html).toContain('aliases: ProCounter');
    expect(html).toContain('1 merged object');
    expect(html).not.toContain('merged_entity_ids');
    expect(html).not.toContain('{&quot;');
  });

  it('renders a load-more control only when a next page exists', () => {
    fakes.query.hasNextPage = true;

    render(
      createElement(ObjectSectionFeed, {
        objectId: 'object-1',
        section: 'facts',
        title: 'Facts',
      }),
    );

    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('keeps empty-event placeholder out of the evidence quick-view body', async () => {
    fakes.query.data = emptyEventData();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(emptyEventResponse())),
    );

    render(
      createElement(ObjectSectionFeed, {
        objectId: 'object-1',
        section: 'events',
        title: 'Events',
      }),
    );

    expect(screen.getByText('[empty event]')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('This reference has no text preview.')).toBeTruthy();
  });
});
