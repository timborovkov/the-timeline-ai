import type { PublicDocument } from '@/lib/public-site';

import { AGENTS_HUB } from '@/components/marketing/agents/content';
import { AGENT_SETUP_CARD, TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { TIMELINE_MCP_COMMAND } from '@/lib/agent-install-content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const REVIEW_DATE = '2026-11-13' as const;

export const AGENTS_HUB_DOCUMENT = {
  canonicalPath: AGENTS_HUB.route,
  kind: 'product',
  title: AGENTS_HUB.seoTitle,
  description: AGENTS_HUB.seoDescription,
  indexability: 'index',
  dates: { modified: REVIEW_DATE, reviewed: REVIEW_DATE },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'weekly', priority: 0.8 },
  structuredData: [
    { type: 'web-page' },
    {
      type: 'breadcrumbs',
      items: [
        { name: 'Home', path: '/' },
        { name: 'Agents', path: AGENTS_HUB.route },
      ],
    },
  ],
  llms: {
    section: 'primary',
    order: 18,
    label: 'Agents',
    summary: AGENTS_HUB.llmsSummary,
    sections: [
      {
        title: AGENT_SETUP_CARD.title,
        body: AGENT_SETUP_CARD.body,
        codeBlock: { content: TIMELINE_AGENT_SETUP_COMMAND, language: 'text' },
      },
      {
        title: AGENTS_HUB.reportIn.title,
        body: AGENTS_HUB.reportIn.body,
        items: AGENTS_HUB.reportIn.paths.map((path) => `${path.name}: ${path.body}`),
      },
      {
        title: AGENTS_HUB.example.label,
        body: `${AGENTS_HUB.example.title} ${AGENTS_HUB.example.body} ${AGENTS_HUB.example.boundary}`,
      },
      {
        title: AGENTS_HUB.readOut.title,
        body: `Hosted MCP lives at ${AGENTS_HUB.readOut.endpoint}. ${AGENTS_HUB.readOut.body} ${AGENTS_HUB.readOut.toolsIntro} ${AGENTS_HUB.readOut.facts.join(' ')}`,
        codeBlock: { content: TIMELINE_MCP_COMMAND, language: 'bash' },
      },
    ],
  },
} as const satisfies PublicDocument;

export const AGENTS_PUBLIC_DOCUMENTS = definePublicDocuments('agents', [AGENTS_HUB_DOCUMENT]);
