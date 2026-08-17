// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

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
            occurredAt: '2026-06-14T12:45:00.000Z',
            source: 'telegram',
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
            occurredAt: '2026-06-14T12:45:00.000Z',
            source: 'telegram',
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

function taskCategoryChangeData(): ObjectSectionQueryData {
  return {
    pages: [
      {
        items: [
          {
            id: 'category-change-1',
            field: 'taskCategory',
            previousValue: {
              category: 'customer_success',
              mode: 'automatic',
              source: 'llm',
              status: 'ready',
            },
            newValue: {
              category: 'sales',
              mode: 'manual',
              source: 'user',
              status: 'ready',
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
vi.mock('@/components/collections/virtual-list', () => ({
  VirtualList: ({
    items,
    renderItem,
    getItemKey,
  }: {
    items: Record<string, unknown>[];
    renderItem: (item: Record<string, unknown>, index: number) => ReactNode;
    getItemKey: (item: Record<string, unknown>, index: number) => string;
  }) =>
    createElement(
      'div',
      null,
      items.map((item, index) =>
        createElement('div', { key: getItemKey(item, index) }, renderItem(item, index)),
      ),
    ),
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
    expect(html).toContain(
      `Observed ${new Date('2026-06-14T12:45:00.000Z').toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Helsinki',
      })} · telegram · confidence 0.91`,
    );
    expect(html).toContain('Fact (2)');
    expect(html).toContain('Objects sharing this fact');
    expect(html).toContain('/app/objects/object-2');
    expect(html).toContain('Northwind');
    expect(html).toContain('/app/objects/object-3');
    expect(html).toContain('Mia Chen');
  });

  it('uses a native disclosure for shared objects', async () => {
    const user = userEvent.setup();
    const { container } = render(
      createElement(ObjectSectionFeed, {
        objectId: 'object-1',
        section: 'facts',
        title: 'Facts',
      }),
    );

    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(container.querySelector('details > div')?.className).toContain('group-open:block');
    expect(container.querySelector('details > div')?.className).not.toContain('group-hover:block');
    expect(screen.getByText('Fact (2)').closest('summary')).toBeTruthy();
    expect(screen.getByText('Fact (2)').closest('summary')?.textContent).toContain(
      'Show 2 other objects sharing this fact',
    );

    await user.click(screen.getByText('Fact (2)'));

    expect(details?.open).toBe(true);
    expect(screen.getByRole('link', { name: /Northwind/i })).toHaveProperty(
      'href',
      'http://localhost:3000/app/objects/object-2',
    );
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

  it('renders task category snapshots as readable change labels', () => {
    fakes.query.data = taskCategoryChangeData();

    const html = renderToStaticMarkup(
      createElement(ObjectSectionFeed, {
        objectId: 'object-1',
        section: 'changes',
        title: 'Changes',
      }),
    );

    expect(html).toContain('Category');
    expect(html).toContain('Customer Success');
    expect(html).toContain('Sales');
    expect(html).not.toContain('updated details');
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
    expect(screen.getByText('[empty event]').className).toContain('line-clamp-5');
    await userEvent.click(screen.getByRole('button', { name: 'View evidence' }));

    expect(await screen.findByText('This reference has no text preview.')).toBeTruthy();
  });
});
