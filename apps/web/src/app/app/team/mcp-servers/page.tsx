import { redirect } from 'next/navigation';

// Phase 11 — the standalone MCP servers page was folded into
// /app/team/integrations (single integrations page: native catalog + MCP
// catalog + connected list + add-custom-server). Keep this route as a
// permanent redirect so existing bookmarks + the OAuth callback's
// `?connected=` deep link still land on the right page.
export default function McpServersRedirect(): never {
  redirect('/app/team/integrations');
}
