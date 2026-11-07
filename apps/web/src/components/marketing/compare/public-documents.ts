import type { PublicDocument } from '@/lib/public-site';

import {
  COMPARE_HUB,
  COMPARE_HUB_ROUTE,
  COMPARE_PAGES,
  type ComparePageContent,
} from '@/components/marketing/compare/content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const REVIEW_DATE = '2026-11-06' as const;

function uniqueCitations(sources: readonly ComparePageContent['facts'][number]['source'][]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.href)) return false;
    seen.add(source.href);
    return true;
  });
}

export const COMPARE_PUBLIC_DOCUMENTS = definePublicDocuments('compare', [
  {
    canonicalPath: COMPARE_HUB_ROUTE,
    kind: 'guide-index',
    title: COMPARE_HUB.seoTitle,
    description: COMPARE_HUB.seoDescription,
    indexability: 'index',
    dates: { modified: REVIEW_DATE, reviewed: REVIEW_DATE },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 0.8 },
    structuredData: [
      { type: 'collection-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Home', path: '/' },
          { name: 'Compare', path: COMPARE_HUB_ROUTE },
        ],
      },
    ],
    llms: {
      section: 'compare',
      order: 0,
      label: 'Compare',
      summary: COMPARE_HUB.seoDescription,
      sections: [
        {
          title: 'What Compare means here',
          body: "Head-to-head pages compare The Timeline with Day AI, Folk, Glean, Geekbot, Suda, MemoryCrow and Achiral, including for people searching those alternatives. Every competitor fact cites that company's own site. Works-with pages live under /integrations and are labelled for native sync, MCP lookup, or coming soon.",
        },
      ],
    },
  },
  ...COMPARE_PAGES.map((page, index): PublicDocument => ({
    canonicalPath: page.route,
    kind: 'product',
    title: page.seoTitle,
    description: page.seoDescription,
    indexability: 'index',
    dates: { modified: REVIEW_DATE, reviewed: REVIEW_DATE },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'monthly', priority: 0.7 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Home', path: '/' },
          { name: 'Compare', path: COMPARE_HUB_ROUTE },
          { name: page.navLabel, path: page.route },
        ],
      },
    ],
    llms: {
      section: 'compare',
      order: index + 1,
      label: page.navLabel,
      summary: page.seoDescription,
      sections: [
        {
          title: `What ${page.name} publishes`,
          body: page.facts.map((fact) => fact.claim).join(' '),
          links: uniqueCitations(page.facts.map((fact) => fact.source)),
        },
        { title: 'What The Timeline is', body: page.timelineSide },
        { title: `When ${page.name} is the better pick`, body: page.whenCompetitorBetter },
      ],
    },
  })),
]);

export function findComparePublicDocument(page: ComparePageContent): PublicDocument {
  const document = COMPARE_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === page.route,
  );
  if (!document) {
    throw new Error(`The public document registry is missing ${page.route}`);
  }
  return document;
}

export function findCompareHubDocument(): PublicDocument {
  const document = COMPARE_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === COMPARE_HUB_ROUTE,
  );
  if (!document) {
    throw new Error('The public document registry is missing the compare hub');
  }
  return document;
}
