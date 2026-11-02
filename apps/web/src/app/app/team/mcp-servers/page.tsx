import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { connectionsHref } from '@/lib/connections';

export const metadata: Metadata = {
  title: 'Team MCP servers',
  description: 'Team MCP server settings are managed on Connections.',
};

// Phase 11 — the standalone MCP servers page was folded into
// Connections. Keep this route as a permanent redirect so old
// bookmarks still resolve. Forward the query string (the OAuth callback
// now points straight at Connections, but legacy callbacks issued
// before that change may still arrive here with ?connected= / ?error=).
export default async function McpServersRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  redirect(connectionsHref(await searchParams));
}
