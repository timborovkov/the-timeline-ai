import { describe, expect, it } from 'vitest';

import type { PublicDocument } from '@/lib/public-site/types';

import { metadataForPublicDocument } from '@/lib/public-site/metadata';

describe('public document metadata', () => {
  it('uses the registry canonical path and indexability', () => {
    const metadata = metadataForPublicDocument(document());
    const draftMetadata = metadataForPublicDocument(
      document({
        canonicalPath: '/future',
        indexability: 'noindex',
        capability: { kind: 'planned' },
        sitemap: false,
        llms: false,
      }),
    );

    expect(metadata).toMatchObject({
      title: 'Guide',
      alternates: { canonical: '/guide' },
      openGraph: { url: '/guide' },
    });
    expect(metadata.robots).toBeUndefined();
    expect(draftMetadata.robots).toEqual({ index: false, follow: false });
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
    structuredData: [],
    llms: { section: 'product-guides', order: 1, summary: 'A useful guide.' },
    ...overrides,
  };
}
