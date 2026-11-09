import type { PublicDocument } from '@/lib/public-site/types';

import {
  MCP_GUIDE_HOSTED_TOOL_NAMES,
  MCP_GUIDE_LOCAL_TOOL_NAMES,
  MCP_GUIDE_PAGE,
  catalogNames,
} from '@/components/marketing/integrations/mcp-guide-content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const hostedToolsLabel = catalogNames(MCP_GUIDE_HOSTED_TOOL_NAMES);
const localDesktopToolsLabel = catalogNames(MCP_GUIDE_LOCAL_TOOL_NAMES);

export const MCP_GUIDE_DOCUMENT = {
  canonicalPath: MCP_GUIDE_PAGE.route,
  kind: 'guide',
  title: MCP_GUIDE_PAGE.seoTitle,
  description: MCP_GUIDE_PAGE.seoDescription,
  indexability: 'index',
  dates: { modified: MCP_GUIDE_PAGE.lastReviewed, reviewed: MCP_GUIDE_PAGE.lastReviewed },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'monthly', priority: 0.7 },
  structuredData: [
    { type: 'web-page' },
    {
      type: 'breadcrumbs',
      items: [
        { name: 'Integrations', path: '/integrations' },
        { name: MCP_GUIDE_PAGE.navLabel, path: MCP_GUIDE_PAGE.route },
      ],
    },
  ],
  llms: {
    section: 'integrations',
    order: 65,
    label: MCP_GUIDE_PAGE.navLabel,
    summary: MCP_GUIDE_PAGE.seoDescription,
    fullSummary: MCP_GUIDE_PAGE.summary,
    sections: [
      {
        title: MCP_GUIDE_PAGE.distinction.title,
        body: `${MCP_GUIDE_PAGE.distinction.inboundBody} ${MCP_GUIDE_PAGE.distinction.outboundBody}`,
      },
      {
        title: MCP_GUIDE_PAGE.setup.title,
        body: `${MCP_GUIDE_PAGE.setup.intro} ${MCP_GUIDE_PAGE.setup.teamBody} ${MCP_GUIDE_PAGE.setup.personalBody} ${MCP_GUIDE_PAGE.setup.formBody}`,
      },
      {
        title: MCP_GUIDE_PAGE.catalog.title,
        body: `${MCP_GUIDE_PAGE.catalog.intro} Hosted catalog tools: ${hostedToolsLabel}. Local desktop: ${localDesktopToolsLabel}. ${MCP_GUIDE_PAGE.catalog.localBody}`,
      },
      {
        title: MCP_GUIDE_PAGE.notNative.title,
        body: MCP_GUIDE_PAGE.notNative.body,
      },
      {
        title: MCP_GUIDE_PAGE.limits.title,
        body: 'Inbound MCP setup is self-serve in the product, with these current limits:',
        items: [...MCP_GUIDE_PAGE.limits.items],
      },
    ],
  },
} as const satisfies PublicDocument;

export const MCP_GUIDE_PUBLIC_DOCUMENTS = definePublicDocuments('mcp-guide', [MCP_GUIDE_DOCUMENT]);
