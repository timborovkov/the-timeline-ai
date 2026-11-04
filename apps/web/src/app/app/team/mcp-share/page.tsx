import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { CONNECT_AGENT_HREF } from '@/lib/connect-agent-content';

export const metadata: Metadata = {
  title: 'MCP share',
  description: 'Timeline MCP settings now live on Connect your agent.',
};

export const dynamic = 'force-dynamic';

export default function McpShareRedirect(): never {
  redirect(CONNECT_AGENT_HREF);
}
