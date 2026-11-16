import type { PublicCapabilityState, PublicDocument } from '@/lib/public-site';

import {
  WORKS_WITH_PAGE_TOOLS,
  type WorksWithTool,
} from '@/components/marketing/integrations/works-with-content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const REVIEW_DATE = '2026-11-12' as const;

function worksWithCapability(tool: WorksWithTool): PublicCapabilityState {
  if (tool.status === 'mcp-lookup') return { kind: 'mcp-access', provider: tool.slug };
  return { kind: 'current-product' };
}

export const WORKS_WITH_PUBLIC_DOCUMENTS = definePublicDocuments(
  'works-with',
  WORKS_WITH_PAGE_TOOLS.map((tool, index): PublicDocument => ({
    canonicalPath: tool.route,
    kind: 'product',
    title: tool.seoTitle,
    description: tool.seoDescription,
    indexability: 'index',
    dates: { modified: REVIEW_DATE, reviewed: REVIEW_DATE },
    capability: worksWithCapability(tool),
    sitemap: { changeFrequency: 'monthly', priority: 0.7 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Integrations', path: '/integrations' },
          { name: tool.name, path: tool.route },
        ],
      },
    ],
    llms: {
      section: 'integrations',
      order: 70 + index,
      label: `${tool.name} · ${tool.statusLabel}`,
      summary: tool.seoDescription,
      sections: [
        { title: 'How it plugs in', body: tool.howItPlugsIn },
        { title: 'What works today', body: tool.today },
        { title: 'What is planned', body: tool.later },
        { title: 'Just getting started', body: tool.gettingStarted },
        { title: `When ${tool.name} alone is the better pick`, body: tool.whenAloneBetter },
      ],
    },
  })),
);

export function findWorksWithPublicDocument(tool: WorksWithTool): PublicDocument {
  const document = WORKS_WITH_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === tool.route,
  );
  if (!document) {
    throw new Error(`The public document registry is missing ${tool.route}`);
  }
  return document;
}
