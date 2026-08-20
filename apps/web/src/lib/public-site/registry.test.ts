import { describe, expect, it } from 'vitest';

import type { PublicDocument } from '@/lib/public-site/types';

import {
  canonicalPublicUrl,
  createPublicDocumentRegistry,
  definePublicDocuments,
} from '@/lib/public-site/registry';

describe('public document registry', () => {
  it('composes document sources and excludes noindex documents from discovery', () => {
    const indexable = document({ canonicalPath: '/guides/one' });
    const noindex = document({
      canonicalPath: '/planned',
      indexability: 'noindex',
      capability: { kind: 'planned', provider: 'Example' },
      sitemap: false,
      llms: false,
    });
    const registry = createPublicDocumentRegistry(
      definePublicDocuments('guides', [indexable]),
      definePublicDocuments('planned-pages', [noindex]),
    );

    expect(registry.all()).toEqual([indexable, noindex]);
    expect(registry.forSitemap()).toEqual([indexable]);
    expect(registry.forLlms('primary')).toEqual([indexable]);
    expect(registry.get('/planned')).toBe(noindex);
  });

  it('rejects duplicate and non-canonical paths', () => {
    const first = definePublicDocuments('first', [document({ canonicalPath: '/guide' })]);
    const second = definePublicDocuments('second', [document({ canonicalPath: '/guide' })]);

    expect(() => createPublicDocumentRegistry(first, second)).toThrow(
      'Duplicate public document canonical path /guide',
    );
    expect(() =>
      definePublicDocuments('invalid-path', [document({ canonicalPath: '/guides/../private' })]),
    ).toThrow('Invalid public canonical path');
    expect(() =>
      definePublicDocuments('invalid-query', [document({ canonicalPath: '/guide?draft=1' })]),
    ).toThrow('Invalid public canonical path');
  });

  it('rejects discovery for noindex and planned documents', () => {
    expect(() =>
      definePublicDocuments('noindex-sitemap', [
        document({ canonicalPath: '/draft', indexability: 'noindex' }),
      ]),
    ).toThrow('Noindex public document cannot appear in public discovery');
    expect(() =>
      definePublicDocuments('planned-index', [
        document({ canonicalPath: '/future', capability: { kind: 'planned' } }),
      ]),
    ).toThrow('Planned public capability must stay noindex and undiscoverable');
  });

  it('requires connector pages to state native, MCP, or planned capability truth', () => {
    expect(() =>
      definePublicDocuments('ambiguous-connector', [
        document({ canonicalPath: '/connector', kind: 'connector' }),
      ]),
    ).toThrow('Connector public document must declare a connector capability');
  });

  it('requires stable valid source dates', () => {
    expect(() =>
      definePublicDocuments('invalid-date', [
        document({ dates: { modified: '2026-02-30', reviewed: '2026-08-12' } }),
      ]),
    ).toThrow('Invalid public document modified date');
    expect(() =>
      definePublicDocuments('stale-review', [
        document({ dates: { modified: '2026-08-12', reviewed: '2026-08-11' } }),
      ]),
    ).toThrow('reviewed date precedes its modified date');
  });

  it.each([
    ['HTTP', 'http://docs.example.test/guide'],
    ['protocol-relative', '//docs.example.test/guide'],
    ['relative', '/guide'],
    ['JavaScript', 'javascript:void(0)'],
  ])('rejects %s LLM section resource links', (_kind, href) => {
    expect(() =>
      definePublicDocuments('unsafe-resource-link', [
        document({
          llms: {
            section: 'primary',
            order: 1,
            summary: 'A useful guide.',
            sections: [
              {
                title: 'Resources',
                body: 'Read more.',
                links: [{ label: 'Documentation', href }],
              },
            ],
          },
        }),
      ]),
    ).toThrow('resource link must be an absolute HTTPS URL');
  });

  it('accepts absolute HTTPS LLM section resource links with URL special characters', () => {
    expect(() =>
      definePublicDocuments('safe-resource-link', [
        document({
          llms: {
            section: 'primary',
            order: 1,
            summary: 'A useful guide.',
            sections: [
              {
                title: 'Resources',
                body: 'Read more.',
                links: [
                  {
                    label: 'Advanced documentation',
                    href: 'https://docs.example.test/guides/r&d/(advanced)?source=agent setup',
                  },
                ],
              },
            ],
          },
        }),
      ]),
    ).not.toThrow();
  });

  it('builds canonical URLs from an origin and preserves the root slash', () => {
    expect(canonicalPublicUrl('https://thetimeline.cc/deploy/path', '/')).toBe(
      'https://thetimeline.cc/',
    );
    expect(canonicalPublicUrl('https://thetimeline.cc/deploy/path', '/help')).toBe(
      'https://thetimeline.cc/help',
    );
    expect(canonicalPublicUrl('https://thetimeline.cc', '/guides/r&d/(notes)')).toBe(
      'https://thetimeline.cc/guides/r%26d/%28notes%29',
    );
  });

  it('rejects non-finite sitemap priorities', () => {
    expect(() =>
      definePublicDocuments('invalid-priority', [
        document({ sitemap: { changeFrequency: 'monthly', priority: Number.NaN } }),
      ]),
    ).toThrow('Public sitemap priority must be a finite number between 0 and 1');
  });
});

function document(overrides: Partial<PublicDocument> = {}): PublicDocument {
  return {
    canonicalPath: '/guide',
    kind: 'guide',
    title: 'Guide',
    description: 'A useful guide.',
    indexability: 'index',
    dates: { modified: '2026-08-12', reviewed: '2026-08-12' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'monthly', priority: 0.7 },
    structuredData: [{ type: 'tech-article' }],
    llms: { section: 'primary', order: 1, summary: 'A useful guide.' },
    ...overrides,
  };
}
