import type { PublicCapabilityState, PublicDocument } from '@/lib/public-site';

import {
  COMPARE_HUB,
  COMPARE_HUB_ROUTE,
  COMPARE_TOOLS,
  type CompareTool,
} from '@/components/marketing/compare/content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const REVIEW_DATE = '2026-11-03' as const;

function compareCapability(tool: CompareTool): PublicCapabilityState {
  if (tool.slug === 'linear') return { kind: 'native-ingestion', provider: 'linear' };
  if (tool.slug === 'jira') return { kind: 'mcp-access', provider: 'jira' };
  if (tool.slug === 'notion') return { kind: 'mcp-access', provider: 'notion' };
  return { kind: 'current-product' };
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
      label: 'Works with',
      summary: COMPARE_HUB.seoDescription,
      sections: [
        {
          title: 'What Compare means here',
          body: 'These pages describe how The Timeline works with tools teams already use. They are not switch or versus pages. Linear has native ingest; Jira and Notion are available through hosted MCP lookup; HubSpot, Attio and Pipedrive native ingest is coming soon.',
        },
      ],
    },
  },
  ...COMPARE_TOOLS.map((tool, index): PublicDocument => ({
    canonicalPath: tool.route,
    kind: 'product',
    title: tool.title,
    description: tool.summary,
    indexability: 'index',
    dates: { modified: REVIEW_DATE, reviewed: REVIEW_DATE },
    capability: compareCapability(tool),
    sitemap: { changeFrequency: 'monthly', priority: 0.7 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Home', path: '/' },
          { name: 'Compare', path: COMPARE_HUB_ROUTE },
          { name: tool.navLabel, path: tool.route },
        ],
      },
    ],
    llms: {
      section: 'compare',
      order: index + 1,
      label: tool.navLabel,
      summary: tool.summary,
      sections: [
        { title: 'Keep the existing tool', body: tool.keepLine },
        { title: 'What works today', body: tool.today },
        { title: 'What is planned', body: tool.later },
      ],
    },
  })),
]);

export function findComparePublicDocument(tool: CompareTool): PublicDocument {
  const document = COMPARE_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === tool.route,
  );
  if (!document) {
    throw new Error(`The public document registry is missing ${tool.route}`);
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
