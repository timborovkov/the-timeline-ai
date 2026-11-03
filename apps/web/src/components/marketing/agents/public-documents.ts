import type { PublicDocument } from '@/lib/public-site';

import { TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { TIMELINE_MCP_COMMAND } from '@/lib/agent-install-content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const REVIEW_DATE = '2026-11-03' as const;

export const AGENTS_HUB_DOCUMENT = {
  canonicalPath: '/agents',
  kind: 'product',
  title: 'Give this to your agent',
  description:
    'Paste one setup line into Claude, ChatGPT, Cursor, Grok, OpenClaw or Hermes. The Timeline MCP server, OAuth, ingest email, webhooks and the timeline skill are documented at llms.txt.',
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
        { name: 'Agents', path: '/agents' },
      ],
    },
  ],
  llms: {
    section: 'primary',
    order: 18,
    label: 'Agents',
    summary:
      'One copyable setup command for Claude, ChatGPT, Cursor, Grok, OpenClaw and Hermes, plus the hosted Timeline MCP server, OAuth, ingest email, webhooks and the plugins/timeline skill.',
    sections: [
      {
        title: 'Give this to your agent',
        body: 'Paste this command into a compatible agent, then follow llms.txt.',
        codeBlock: { content: TIMELINE_AGENT_SETUP_COMMAND, language: 'text' },
      },
      {
        title: 'Hosted MCP',
        body: 'Streamable HTTP MCP lives at https://thetimeline.cc/api/mcp/server. Compatible clients use browser OAuth: sign in, choose a team, and approve scopes. Static team keys (tla_) are a manual-client fallback and see team-visible data only.',
        codeBlock: { content: TIMELINE_MCP_COMMAND, language: 'bash' },
      },
    ],
  },
} as const satisfies PublicDocument;

export const AGENTS_PUBLIC_DOCUMENTS = definePublicDocuments('agents', [AGENTS_HUB_DOCUMENT]);
