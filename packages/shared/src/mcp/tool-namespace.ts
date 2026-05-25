// Phase 11 — Namespace MCP tools per server so two servers exposing
// `search` don't collide. Format mirrors Vernix and Claude Code:
//   mcp__<serverIdNoDashes>__<toolName>
//
// The serverId is the UUID with dashes removed (matches Vernix shape) so
// the resulting tool name is a valid identifier in JSON-Schema and most
// SDKs without quoting.

export function namespaceToolName(serverId: string, toolName: string): string {
  const id = serverId.replace(/-/g, '');
  return `mcp__${id}__${toolName}`;
}

export function parseNamespacedToolName(
  namespaced: string,
): { serverIdCompact: string; toolName: string } | null {
  const m = /^mcp__([0-9a-f]{32})__(.+)$/.exec(namespaced);
  if (!m) return null;
  const compact = m[1];
  const tool = m[2];
  if (!compact || !tool) return null;
  return { serverIdCompact: compact, toolName: tool };
}

export function compactToServerId(compact: string): string {
  if (compact.length !== 32) return compact;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
