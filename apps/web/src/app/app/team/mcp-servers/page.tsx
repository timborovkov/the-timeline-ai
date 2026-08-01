import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Team MCP servers',
  description: 'Team MCP server settings are managed in Integrations.',
};

// Phase 11 — the standalone MCP servers page was folded into
// /app/team/integrations. Keep this route as a permanent redirect so old
// bookmarks still resolve. Forward the query string (the OAuth callback
// now points straight at /integrations, but legacy callbacks issued
// before that change may still arrive here with ?connected= / ?error=).
export default async function McpServersRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') qs.append(k, v);
    else if (Array.isArray(v)) {
      for (const value of v) qs.append(k, value);
    }
  }
  const suffix = qs.toString();
  redirect(`/app/team/integrations${suffix ? `?${suffix}` : ''}`);
}
