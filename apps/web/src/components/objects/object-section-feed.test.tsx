import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  query: {
    data: {
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
    },
    isPending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
}));

vi.mock('@/lib/use-paginated-queries', () => ({
  useObjectSectionQuery: () => fakes.query,
}));

const { ObjectSectionFeed } = await import('./object-section-feed.js');

beforeEach(() => {
  vi.clearAllMocks();
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
});
